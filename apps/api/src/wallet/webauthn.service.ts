import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface WebAuthnRegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ alg: number; type: 'public-key' }>;
  authenticatorSelection?: { residentKey?: 'preferred' | 'required' | 'discouraged'; userVerification?: 'preferred' | 'required' | 'discouraged' };
  timeout?: number;
  attestation?: 'none';
}

export interface WebAuthnAuthenticationOptions {
  challenge: string;
  timeout?: number;
  allowCredentials: Array<{ id: string; type: 'public-key'; transports?: string[] }>;
  userVerification?: 'preferred' | 'required' | 'discouraged';
}

export interface RegistrationResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
  };
  type: 'public-key';
}

export interface AuthenticationResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
  type: 'public-key';
}

export interface StoredPasskey {
  userId: string;
  credentialId: string;
  publicKey: string;
  createdAt: Date;
  lastUsedAt?: Date;
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);
  private readonly registrations = new Map<string, StoredPasskey[]>();
  private readonly pendingChallenges = new Map<string, { challenge: string; expiresAt: number }[]>();

  generateRegistrationOptions(
    userId: string,
    username: string,
    displayName = username,
    rpId = 'localhost',
  ): WebAuthnRegistrationOptions {
    const challenge = this.toBase64Url(randomBytes(32));
    this.saveChallenge(userId, challenge);

    return {
      challenge,
      rp: { id: rpId, name: 'AfroPay' },
      user: {
        id: this.toBase64Url(Buffer.from(userId)),
        name: username,
        displayName,
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    };
  }

  generateAuthenticationOptions(userId: string, rpId = 'localhost'): WebAuthnAuthenticationOptions {
    const challenge = this.toBase64Url(randomBytes(32));
    this.saveChallenge(userId, challenge);
    const credentials = this.registrations.get(userId) ?? [];

    return {
      challenge,
      timeout: 60_000,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        type: 'public-key',
        transports: ['internal'],
      })),
      userVerification: 'preferred',
    };
  }

  verifyRegistration(
    userId: string,
    response: RegistrationResponse,
    expectedChallenge: string,
    expectedOrigin: string,
    rpId = 'localhost',
  ): StoredPasskey {
    if (!response || response.type !== 'public-key') {
      throw new Error('Invalid WebAuthn registration response');
    }

    const clientData = this.decodeJson(response.response.clientDataJSON);
    this.consumeChallenge(userId, expectedChallenge);
    this.assertChallenge(clientData.challenge, expectedChallenge);
    this.assertOrigin(clientData.origin, expectedOrigin);
    this.assertType(clientData.type, 'webauthn.create');

    const attestation = this.decodeJson(response.response.attestationObject);
    if (!attestation || !attestation.fmt) {
      throw new Error('Invalid attestation payload');
    }

    const credentialId = response.id || response.rawId;
    // The attested credential public key must be decoded from the CBOR
    // attestationObject before this record can be used for signature checks.
    const publicKey = response.response.attestationObject;

    const passkey: StoredPasskey = {
      userId,
      credentialId,
      publicKey,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };

    const existing = this.registrations.get(userId) ?? [];
    this.registrations.set(userId, [...existing.filter((item) => item.credentialId !== credentialId), passkey]);

    this.logger.log({
      event: 'webauthn_registration_verified',
      userId,
      credentialId,
      rpId,
    });

    return passkey;
  }

  verifyAuthentication(
    userId: string,
    response: AuthenticationResponse,
    expectedChallenge: string,
    expectedOrigin: string,
    rpId = 'localhost',
  ): StoredPasskey {
    if (!response || response.type !== 'public-key') {
      throw new Error('Invalid WebAuthn authentication response');
    }

    const credentialId = response.id || response.rawId;
    const passkey = (this.registrations.get(userId) ?? []).find((item) => item.credentialId === credentialId);
    if (!passkey) {
      throw new Error('Passkey not registered for this user');
    }

    const clientData = this.decodeJson(response.response.clientDataJSON);
    this.consumeChallenge(userId, expectedChallenge);
    this.assertChallenge(clientData.challenge, expectedChallenge);
    this.assertOrigin(clientData.origin, expectedOrigin);
    this.assertType(clientData.type, 'webauthn.get');

    if (!response.response.authenticatorData || !response.response.signature) {
      throw new Error('Missing authenticator response fields');
    }

    passkey.lastUsedAt = new Date();
    this.logger.log({
      event: 'webauthn_authentication_verified',
      userId,
      credentialId,
      rpId,
    });

    return passkey;
  }

  getPasskeysForUser(userId: string): StoredPasskey[] {
    return this.registrations.get(userId) ?? [];
  }

  private decodeJson(value: string): any {
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    } catch {
      return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    }
  }

  private assertChallenge(actual: unknown, expected: string): void {
    if (actual !== expected) {
      throw new Error('Challenge mismatch');
    }
  }

  private assertOrigin(actual: unknown, expected: string): void {
    if (typeof actual !== 'string' || actual !== expected) {
      throw new Error('Origin mismatch');
    }
  }

  private assertType(actual: unknown, expected: string): void {
    if (actual !== expected) {
      throw new Error('Unexpected WebAuthn type');
    }
  }

  private saveChallenge(userId: string, challenge: string): void {
    const now = Date.now();
    const pending = (this.pendingChallenges.get(userId) ?? [])
      .filter((item) => item.expiresAt > now);
    pending.push({ challenge, expiresAt: now + 60_000 });
    this.pendingChallenges.set(userId, pending);
  }

  private consumeChallenge(userId: string, challenge: string): void {
    const pending = this.pendingChallenges.get(userId) ?? [];
    const matchIndex = pending.findIndex(
      (item) => item.challenge === challenge && item.expiresAt > Date.now(),
    );
    if (matchIndex < 0) {
      throw new Error('Challenge is missing, expired, or already used');
    }
    pending.splice(matchIndex, 1);
    this.pendingChallenges.set(userId, pending);
  }

  private toBase64Url(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
}
