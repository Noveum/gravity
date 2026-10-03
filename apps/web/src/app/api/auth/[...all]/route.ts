import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth/server.ts';
import { withSocketRevocation } from '@/lib/auth/sign-out.ts';

const handlers = toNextJsHandler(auth.handler);

export function GET(request: Request): Promise<Response> {
  return handlers.GET(request);
}

export function POST(request: Request): Promise<Response> {
  return withSocketRevocation(request, handlers.POST);
}
