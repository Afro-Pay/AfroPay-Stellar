import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class StellarAddressPipe implements PipeTransform<string> {
  transform(value: string): string {
    if (!value) {
      throw new BadRequestException('Stellar address is required');
    }

    // Check if it's a valid Stellar address format
    // Stellar addresses start with 'G' and are 56 characters long
    if (!value.startsWith('G') || value.length !== 56) {
      throw new BadRequestException(
        `Invalid Stellar address format. Address must start with 'G' and be 56 characters long.`,
      );
    }

    // Additional validation - check if it contains only valid characters
    // Stellar addresses are base32 encoded
    const validChars = /^[A-Z2-7]{56}$/;
    if (!validChars.test(value)) {
      throw new BadRequestException(
        'Invalid Stellar address format. Address contains invalid characters.',
      );
    }

    return value;
  }
}
