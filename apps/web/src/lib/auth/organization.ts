import { organization } from 'better-auth/plugins';

export function organizationSessionPlugin() {
  const plugin = organization({
    schema: {
      invitation: {
        additionalFields: {
          tokenHash: { type: 'string', required: false, input: false },
        },
      },
    },
  });
  return {
    ...plugin,
    endpoints: {
      setActiveOrganization: plugin.endpoints.setActiveOrganization,
    },
  };
}
