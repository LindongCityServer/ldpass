import { Module } from '@nestjs/common';
import { AddPassTokensController } from './add-pass-tokens.controller.js';
import { AddPassTokensService } from './add-pass-tokens.service.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminClientApplicationsController } from './admin-client-applications.controller.js';
import { AdminClientApplicationsService } from './admin-client-applications.service.js';
import { AdminPassesController } from './admin-passes.controller.js';
import { AdminPassesService } from './admin-passes.service.js';
import { AdminProvidersController } from './admin-providers.controller.js';
import { AdminProvidersService } from './admin-providers.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  controllers: [
    AdminDashboardController,
    AdminUsersController,
    AddPassTokensController,
    AdminPassesController,
    AdminProvidersController,
    AdminClientApplicationsController,
  ],
  providers: [
    AdminDashboardService,
    AdminUsersService,
    AddPassTokensService,
    AdminPassesService,
    AdminProvidersService,
    AdminClientApplicationsService,
  ],
})
export class AdminModule {}
