import { fileIdSchema } from '@gravity/shared/validators';
import { downloadResponse } from '@/lib/api/file-download.ts';
import { handle } from '@/lib/api/handler.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return await handle(
    async (principal) =>
      await downloadResponse(
        principal,
        fileIdSchema.parse((await params).id),
        new URL(request.url).searchParams.get('preview') === 'true',
      ),
  );
}
