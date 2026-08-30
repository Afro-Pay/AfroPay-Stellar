import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class Sep12Service {
  constructor(private readonly prisma: PrismaService) {}

  async getCustomer(account: string, type?: string, id?: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { publicKey: account },
      include: { user: { include: { kyc: true } } }
    });
    
    if (!wallet) throw new NotFoundException('Wallet not found');

    const kyc = wallet.user.kyc;
    if (!kyc) {
      return { status: 'NEEDS_INFO' };
    }

    // Map KycStatus to SEP-12 status
    let status = 'NEEDS_INFO';
    if (kyc.status === 'APPROVED') status = 'ACCEPTED';
    else if (kyc.status === 'REJECTED') status = 'REJECTED';
    else if (kyc.status === 'PENDING') status = 'PROCESSING';

    const response: any = {
      id: kyc.id,
      status,
      provided_fields: {},
    };

    if (kyc.firstName) response.provided_fields.first_name = { description: 'First name', type: 'string', status: 'ACCEPTED' };
    if (kyc.lastName) response.provided_fields.last_name = { description: 'Last name', type: 'string', status: 'ACCEPTED' };
    if (kyc.idType) response.provided_fields.id_type = { description: 'ID Type', type: 'string', status: 'ACCEPTED' };
    if (kyc.photoId) response.provided_fields.photo_id = { description: 'Photo ID', type: 'binary', status: 'ACCEPTED' };
    
    if (status === 'REJECTED' && kyc.rejectionReason) {
      response.message = kyc.rejectionReason;
    }

    return response;
  }

  async putCustomer(account: string, data: any, file?: any) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { publicKey: account },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');

    const updateData: any = {};
    if (data.first_name) updateData.firstName = data.first_name;
    if (data.last_name) updateData.lastName = data.last_name;
    if (data.id_type) updateData.idType = data.id_type;
    
    if (file) {
      const documentRef = `mock-s3-key:${file.originalname}`;
      updateData.photoId = documentRef;
      updateData.documentRef = documentRef;
    }
    
    updateData.status = 'PENDING';

    const kyc = await this.prisma.kycRecord.upsert({
      where: { userId: wallet.userId },
      create: {
        userId: wallet.userId,
        ...updateData,
      },
      update: {
        ...updateData,
      },
    });

    // Notify third-party integration of KYC status transition
    this.notifyThirdPartyWebhook(account, kyc.status);

    return { id: kyc.id };
  }

  private async notifyThirdPartyWebhook(account: string, status: string) {
    // In a real app we would call a configurable webhook URL
    // e.g., using HttpService or fetch
    const webhookUrl = process.env.KYC_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account, kyc_status: status }),
        });
      } catch (error) {
        console.error('Failed to notify third-party webhook', error);
      }
    }
  }
}
