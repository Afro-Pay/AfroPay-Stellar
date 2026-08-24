import { Controller, Get, Post, Query } from '@nestjs/common';
import { RpcClientService, RpcEndpointKind, RpcEndpointState } from './rpc-client.service';

@Controller('rpc')
export class RpcHealthController {
  constructor(private readonly rpcClient: RpcClientService) {}

  @Get('health')
  getHealth(@Query('kind') kind?: RpcEndpointKind): RpcEndpointState[] {
    return this.rpcClient.getSnapshot(kind);
  }

  @Post('health/refresh')
  async refreshHealth(@Query('kind') kind?: RpcEndpointKind): Promise<RpcEndpointState[]> {
    await this.rpcClient.refreshHealth();
    return this.rpcClient.getSnapshot(kind);
  }
}
