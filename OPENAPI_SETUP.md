# OpenAPI/Swagger Integration Setup Guide

This document explains the OpenAPI 3.1 integration for the AfroPay-Stellar API and how to use it.

## Overview

The API documentation is auto-generated from NestJS decorators (`@ApiProperty`, `@ApiOperation`, etc.) and served via Swagger UI in non-production environments.

## Features Implemented

✅ **Swagger UI** at `/api/docs` (development/test only)  
✅ **Auto-generated OpenAPI 3.1 spec** from NestJS decorators  
✅ **Complete DTO annotations** with examples and validation rules  
✅ **JWT authentication support** with "Authorize" button  
✅ **Interactive API testing** directly from browser  
✅ **Exported `openapi.json`** to `docs/` directory  
✅ **Production-safe** (documentation disabled in production)  

## Quick Start

### 1. Start the Development Server

```bash
cd apps/api
npm install
npm run start:dev
```

The server will:
- Start on port 3000 (or `PORT` environment variable)
- Generate `docs/openapi.json` automatically
- Serve Swagger UI at `http://localhost:3000/api/docs`

### 2. Access the Documentation

Open your browser and navigate to:
```
http://localhost:3000/api/docs
```

You should see the interactive Swagger UI with all API endpoints.

### 3. Test the API

1. Click "Authorize" button (top right)
2. Get a JWT token:
   - Register: `POST /api/auth/register`
   - Or Login: `POST /api/auth/login`
3. Copy the `access_token` from the response
4. Paste it into the "Value" field in the authorization modal
5. Click "Authorize"
6. Now you can test any authenticated endpoint with "Try it out"

## Project Structure

### Modified Files

#### `apps/api/src/main.ts`
- Added Swagger module configuration
- Conditional setup (non-production only)
- Auto-export to `docs/openapi.json`

#### DTOs with `@ApiProperty` decorators:
- `apps/api/src/transaction/dto/transaction.dto.ts` ✅
- `apps/api/src/auth/dto/auth.dto.ts` ✅
- `apps/api/src/wallet/dto/wallet.dto.ts` ✅
- `apps/api/src/kyc/kyc.controller.ts` ✅ (DTOs defined inline)
- `apps/api/src/anchor/dto/deposit-response.dto.ts` ✅
- `apps/api/src/anchor/dto/withdraw-response.dto.ts` ✅
- `apps/api/src/anchor/dto/anchor.dto.ts` ✅

#### Controllers with Swagger decorators:
- `apps/api/src/transaction/transaction.controller.ts` ✅
- `apps/api/src/auth/auth.controller.ts` ✅
- `apps/api/src/wallet/wallet.controller.ts` ✅
- `apps/api/src/kyc/kyc.controller.ts` ✅
- `apps/api/src/anchor/anchor.controller.ts` ✅

#### Documentation:
- `docs/api-reference.md` - Updated to point to generated spec
- `docs/openapi.json` - Generated OpenAPI 3.1 specification

## Environment-Specific Behavior

### Development (`NODE_ENV=development` or undefined)
- ✅ Swagger UI enabled at `/api/docs`
- ✅ OpenAPI spec exported to `docs/openapi.json`
- ✅ Console logs API documentation URL

### Test (`NODE_ENV=test`)
- ✅ Swagger UI enabled at `/api/docs`
- ✅ OpenAPI spec exported to `docs/openapi.json`

### Production (`NODE_ENV=production`)
- ❌ Swagger UI **disabled** (404 at `/api/docs`)
- ❌ OpenAPI spec **not exported**
- ✅ Security: No documentation exposure in production

## Swagger Configuration Details

### DocumentBuilder Options

```typescript
new DocumentBuilder()
  .setTitle('AfroPay-Stellar API')
  .setDescription('Cross-border remittance platform...')
  .setVersion('1.0.0')
  .addBearerAuth({ /* JWT config */ }, 'JWT-auth')
  .addServer('http://localhost:3000', 'Local Development')
  .addServer('https://api-staging.afropay.io', 'Staging')
  .addTag('auth', 'Authentication and user registration')
  .addTag('wallet', 'Stellar wallet management')
  .addTag('transaction', 'Payment transactions and history')
  .addTag('kyc', 'Know Your Customer verification')
  .addTag('anchor', 'Stellar anchor integrations')
  .addTag('audit', 'Audit logs and compliance')
  .addTag('admin', 'Administrative operations')
  .build()
```

### Swagger UI Customization

```typescript
SwaggerModule.setup('api/docs', app, document, {
  customSiteTitle: 'AfroPay API Docs',
  customCss: '.swagger-ui .topbar { display: none }', // Hide Swagger topbar
  swaggerOptions: {
    persistAuthorization: true,     // Remember JWT token
    docExpansion: 'none',            // Collapse all sections by default
    filter: true,                    // Enable endpoint search
    showRequestDuration: true,       // Show request timing
  },
})
```

## DTO Annotation Patterns

### Basic Property
```typescript
@ApiProperty({
  description: 'User email address',
  example: 'user@example.com',
})
@IsEmail()
email: string;
```

### Optional Property
```typescript
@ApiPropertyOptional({
  description: 'Optional memo text',
  example: 'Payment for services',
})
@IsOptional()
@IsString()
memo?: string;
```

### Enum Property
```typescript
@ApiProperty({
  description: 'Transaction status',
  enum: ['PENDING', 'SUCCESS', 'FAILED', 'PENDING_REVIEW'],
  example: 'SUCCESS',
})
@IsEnum(['PENDING', 'SUCCESS', 'FAILED', 'PENDING_REVIEW'])
status: string;
```

### Number with Constraints
```typescript
@ApiProperty({
  description: 'Number of records per page',
  example: 25,
  minimum: 1,
  maximum: 100,
  default: 25,
})
@IsInt()
@Min(1)
@Max(100)
limit: number;
```

### Nested Object/Array
```typescript
@ApiProperty({
  description: 'Array of transaction records',
  type: [TransactionResponseDto],
})
data: TransactionResponseDto[];
```

## Controller Annotation Patterns

### Basic Endpoint
```typescript
@Post('send')
@ApiOperation({ summary: 'Send payment' })
@ApiResponse({ status: 201, description: 'Payment sent', type: TransactionResponseDto })
@ApiResponse({ status: 400, description: 'Invalid data' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
async sendPayment(@Body() dto: SendDto) { /* ... */ }
```

### With Authentication
```typescript
@Controller('transactions')
@ApiTags('transaction')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')  // Adds "Authorize" button in Swagger UI
export class TransactionController { /* ... */ }
```

### With Custom Headers
```typescript
@Post('send')
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description: 'Optional UUID for idempotent requests',
})
async sendPayment(
  @Headers('idempotency-key') idempotencyKey?: string
) { /* ... */ }
```

### With Query Parameters
```typescript
@Get()
@ApiQuery({
  name: 'status',
  required: false,
  enum: ['PENDING', 'SUCCESS', 'FAILED'],
})
async getTransactions(@Query('status') status?: string) { /* ... */ }
```

## CI/CD Integration

### Automatic Spec Generation

Add to your CI pipeline (`.github/workflows/ci.yml`):

```yaml
- name: Generate OpenAPI Spec
  run: |
    cd apps/api
    npm install
    npm run build
    npm run start:dev &
    sleep 10  # Wait for server to start and generate spec
    kill $!   # Stop the server
    
- name: Commit Updated Spec
  run: |
    git config --local user.email "ci@afropay.io"
    git config --local user.name "CI Bot"
    git add docs/openapi.json
    git diff --staged --quiet || git commit -m "chore: update OpenAPI spec"
```

### Version Control

The `docs/openapi.json` file should be:
- ✅ Committed to git (for reference and diffs)
- ✅ Regenerated on every build
- ✅ Reviewed in PRs when API changes are made

## Troubleshooting

### Issue: Swagger UI shows empty/incomplete spec

**Cause**: Missing `@ApiProperty` decorators on DTOs

**Solution**: Add `@ApiProperty()` to all DTO properties:
```typescript
// Before (won't appear in Swagger)
@IsString()
name: string;

// After (appears in Swagger with documentation)
@ApiProperty({ description: 'User name', example: 'John Doe' })
@IsString()
name: string;
```

### Issue: Endpoint doesn't appear in Swagger UI

**Cause**: Missing `@ApiTags()` or `@ApiOperation()` decorator

**Solution**: Add tags and operation summary:
```typescript
@Controller('example')
@ApiTags('example')  // Add this
export class ExampleController {
  @Get()
  @ApiOperation({ summary: 'Get examples' })  // Add this
  getExamples() { /* ... */ }
}
```

### Issue: Authentication not working in Swagger UI

**Cause**: Missing `@ApiBearerAuth()` decorator

**Solution**: Add to controller or specific routes:
```typescript
@Controller('protected')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')  // Add this - matches security scheme name
export class ProtectedController { /* ... */ }
```

### Issue: `docs/openapi.json` not generated

**Cause**: Server not started in development mode

**Solution**:
```bash
cd apps/api
NODE_ENV=development npm run start:dev
# Check logs for: "📄 OpenAPI spec exported to..."
```

### Issue: Swagger UI accessible in production

**Cause**: `NODE_ENV` not set to `production`

**Solution**: Ensure environment variable is set:
```bash
export NODE_ENV=production
npm start
# /api/docs should return 404
```

## Best Practices

### 1. Always Add Examples
```typescript
@ApiProperty({
  description: 'Stellar public key',
  example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',  // ✅ Good
})
publicKey: string;
```

### 2. Document All Status Codes
```typescript
@ApiResponse({ status: 200, description: 'Success' })
@ApiResponse({ status: 400, description: 'Invalid request' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 404, description: 'Not found' })
@ApiResponse({ status: 429, description: 'Rate limited' })
@ApiResponse({ status: 500, description: 'Internal server error' })
```

### 3. Use DTOs for All Request/Response Shapes
```typescript
// ✅ Good - Type-safe and documented
@Post()
async create(@Body() dto: CreateDto): Promise<ResponseDto> { /* ... */ }

// ❌ Bad - No automatic documentation
@Post()
async create(@Body() data: any): Promise<any> { /* ... */ }
```

### 4. Group Related Endpoints with Tags
```typescript
@ApiTags('transaction')  // All endpoints grouped under "transaction"
@Controller('transactions')
export class TransactionController { /* ... */ }
```

### 5. Keep Descriptions Clear and Concise
```typescript
@ApiProperty({
  description: 'Transaction amount in base units',  // ✅ Clear
  example: '10.50',
})
amount: string;

// ❌ Too verbose or unclear
@ApiProperty({
  description: 'This is the amount field which represents...',
})
```

## Acceptance Criteria (Issue #229)

- [x] `@nestjs/swagger` installed and configured in `apps/api/src/main.ts`
- [x] All request/response DTOs have `@ApiProperty` annotations with examples
- [x] `GET /api/docs` returns Swagger UI in development and test; 404 in production
- [x] `docs/openapi.json` committed and updated as generated artifact
- [x] `docs/api-reference.md` replaced with pointer to generated spec

## Additional Resources

- [NestJS Swagger Documentation](https://docs.nestjs.com/openapi/introduction)
- [OpenAPI 3.1 Specification](https://spec.openapis.org/oas/v3.1.0)
- [Swagger UI Documentation](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/)

## Support

- **Issue Tracker**: [GitHub Issues](https://github.com/El-Chapo-Npm/AfroPay-Stellar/issues)
- **API Docs**: http://localhost:3000/api/docs (development only)
- **Generated Spec**: `docs/openapi.json`

---

**Implemented**: Issue #229  
**Status**: Complete  
**Documentation Updated**: August 2026
