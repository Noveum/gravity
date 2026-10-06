import { publicFileTokenSchema } from '@gravity/shared/validators';
import { downloadResponse } from '@/lib/api/file-download.ts';
import { handleRoute } from '@/lib/api/handler.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  return await handleRoute(
    async () =>
      await downloadResponse(
        null,
        publicFileTokenSchema.parse((await params).token),
        new URL(request.url).searchParams.get('preview') === 'true',
      ),
  );
}
