import { BadRequestException } from '@nestjs/common';
import { RpcHealthController } from './rpc-health.controller';
import { RpcClientService } from './rpc-client.service';

describe('RpcHealthController', () => {
  let controller: RpcHealthController;
  let rpcClient: jest.Mocked<Pick<RpcClientService, 'getSnapshot' | 'refreshHealth'>>;

  beforeEach(() => {
    rpcClient = {
      getSnapshot: jest.fn().mockReturnValue([{ id: 'soroban-1' }]),
      refreshHealth: jest.fn().mockResolvedValue(undefined),
    };
    controller = new RpcHealthController(rpcClient as any);
  });

  it('returns a filtered health snapshot', () => {
    expect(controller.getHealth('soroban')).toEqual([{ id: 'soroban-1' }]);
    expect(rpcClient.getSnapshot).toHaveBeenCalledWith('soroban');
  });

  it('refreshes health before returning a snapshot', async () => {
    await expect(controller.refreshHealth('horizon')).resolves.toEqual([{ id: 'soroban-1' }]);
    expect(rpcClient.refreshHealth).toHaveBeenCalledTimes(1);
    expect(rpcClient.getSnapshot).toHaveBeenCalledWith('horizon');
  });

  it('rejects unsupported endpoint kinds', () => {
    expect(() => controller.getHealth('stellar-core' as any)).toThrow(BadRequestException);
  });
});
