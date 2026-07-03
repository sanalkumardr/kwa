import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * One structured log line per request: method, path, status, duration, and the
 * acting user (when authenticated). Enough to trace activity and spot slow or
 * failing endpoints without a full APM stack.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { userId?: string }>();
    const res = http.getResponse<Response>();
    const start = Date.now();
    const { method, originalUrl } = req;

    return next.handle().pipe(
      tap({
        next: () => this.write(method, originalUrl, res.statusCode, start, req.userId),
        error: (err: { status?: number }) =>
          this.write(method, originalUrl, err?.status ?? 500, start, req.userId),
      }),
    );
  }

  private write(
    method: string,
    url: string,
    status: number,
    start: number,
    userId?: string,
  ): void {
    const ms = Date.now() - start;
    const who = userId ? ` user=${userId}` : '';
    const line = `${method} ${url} ${status} ${ms}ms${who}`;
    if (status >= 500) this.logger.error(line);
    else if (status >= 400) this.logger.warn(line);
    else this.logger.log(line);
  }
}
