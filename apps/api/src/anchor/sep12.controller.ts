import { Controller, Get, Put, Body, Query, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Sep10AuthGuard } from './sep10-auth.guard';
import { Sep12Service } from './sep12.service';

@ApiTags('sep12')
@Controller('sep12')
@UseGuards(Sep10AuthGuard)
@ApiBearerAuth('JWT-auth')
export class Sep12Controller {
  constructor(private readonly sep12Service: Sep12Service) {}

  @Get('customer')
  @ApiOperation({ summary: 'Get customer KYC status (SEP-12)' })
  @ApiResponse({ status: 200, description: 'Customer status retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCustomer(
    @Request() req: any,
    @Query('type') type?: string,
    @Query('id') id?: string,
  ) {
    const account = req.sep10User.account;
    return this.sep12Service.getCustomer(account, type, id);
  }

  @Put('customer')
  @ApiOperation({ summary: 'Update customer KYC info (SEP-12)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('photo_id'))
  @ApiResponse({ status: 200, description: 'Customer info updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async putCustomer(
    @Request() req: any,
    @Body() body: any,
    @UploadedFile() file?: any,
  ) {
    const account = req.sep10User.account;
    return this.sep12Service.putCustomer(account, body, file);
  }
}
