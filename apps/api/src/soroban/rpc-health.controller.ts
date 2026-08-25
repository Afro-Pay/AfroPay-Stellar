import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { RpcClientService, RpcEndpointKind, RpcEndpointState } from './rpc-client.service';

@Controller('rpc')
export class RpcHealthController {
  constructor(private readonly rpcClient: RpcClientService) {}

  @Get('health')
  getHealth(@Query('kind') kind?: RpcEndpointKind): RpcEndpointState[] {
    return this.rpcClient.getSnapshot(this.parseKind(kind));
  }

  @Post('health/refresh')
  async refreshHealth(@Query('kind') kind?: RpcEndpointKind): Promise<RpcEndpointState[]> {
    await this.rpcClient.refreshHealth();
    return this.rpcClient.getSnapshot(this.parseKind(kind));
  }

  private parseKind(kind?: string): RpcEndpointKind | undefined {
    if (!kind) {
      return undefined;
    }
    if (kind === 'soroban' || kind === 'horizon') {
      return kind;
    }
    throw new BadRequestException('kind must be either "soroban" or "horizon"');
  }
}
