import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** Injects the authenticated app_user.id set by AuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    if (!req.userId) {
      throw new Error('CurrentUser used without AuthGuard');
    }
    return req.userId;
  },
);
