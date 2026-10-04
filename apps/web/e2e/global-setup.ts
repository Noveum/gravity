import {
  acceptInvite,
  createBrand,
  createInvite,
  createOrganization,
  resolvePrincipal,
  upsertPerson,
} from '@gravity/core';
import { createUser } from '@gravity/core/test-support';
import { writeFixture } from './fixture.ts';

export default async function globalSetup(): Promise<void> {
  process.env['ALLOWED_EMAIL_DOMAINS'] = '';
  const suffix = Date.now().toString(36);
  const owner = await createUser(`E2E Owner ${suffix}`);
  const teammate = await createUser(`E2E Teammate ${suffix}`);
  const workspace = await createOrganization(owner.id, {
    name: `E2E ${suffix}`,
    slug: `e2e-${suffix}`,
  });
  const admin = await resolvePrincipal(owner.id, workspace.organization.id);
  const { token } = await createInvite(admin, { email: teammate.email, role: 'member' });
  await acceptInvite(token, teammate.id);
  const brandName = `Nimbus ${suffix}`;
  const brand = await createBrand({ principal: admin }, { name: brandName });
  const importBrandName = `Harbor ${suffix}`;
  const importBrand = await createBrand({ principal: admin }, { name: importBrandName });
  const personName = `Mira Castell ${suffix}`;
  await upsertPerson(
    { principal: admin },
    { name: personName, emails: [`mira-${suffix}@kestrel.example`] },
  );
  writeFixture({
    ownerEmail: owner.email,
    teammateEmail: teammate.email,
    workspaceName: `E2E ${suffix}`,
    brandName,
    pipelineKey: brand.pipeline.key,
    pipelineId: brand.pipeline.id,
    personName,
    importBrandName,
    importPipelineKey: importBrand.pipeline.key,
    importPipelineId: importBrand.pipeline.id,
  });
}
