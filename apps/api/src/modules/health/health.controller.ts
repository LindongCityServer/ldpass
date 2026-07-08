import { Controller, Get } from '../../framework.js';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      ok: true,
      service: 'ldpass-next-api',
    };
  }
}
