import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

/**
 * Verifies the bearer JWT and attaches the user id (token `sub` claim) to the
 * request as `req.userId`. That id is an app_user.id and is what gets pushed
 * into `kwa.current_user_id` by DatabaseService.withUser.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = jwt.verify(
        token,
        this.config.getOrThrow<string>('JWT_SECRET'),
      ) as jwt.JwtPayload;
      if (!payload.sub) throw new Error('token has no sub');
      req.userId = String(payload.sub);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
