import { Module } from '@nestjs/common';
import { ThemeScheduleService } from './theme-schedule.service.js';
import { ThemeController } from './theme.controller.js';

@Module({
  controllers: [ThemeController],
  providers: [ThemeScheduleService],
})
export class ThemeModule {}
