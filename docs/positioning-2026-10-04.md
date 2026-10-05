# Public site positioning review — 4 October 2026

Gravity serves a team handling many conversations across several products. Its opening message is **Know who to follow up with next.**, with the category and audience stated directly above: **Open-source CRM for founders and small sales teams**. The page explains the daily next-action queue, distinct product relationships and permission-bound assistant context before discussing infrastructure. This is a positioning choice based on the reviewed pages, not evidence that competitors lack these features.

## Audience and message focus

The primary ICP is founders and small B2B sales teams doing hands-on outreach, handling replies and tracking meeting commitments themselves. The best initial fit is a team with repeated follow-ups, shared conversations and context spread across several products. Multiple products are a differentiator, not a prerequisite for understanding the page. Agencies and other teams selling several offerings are a secondary fit.

The person choosing Gravity may also be responsible for running it: a technical founder or a small team with someone who can deploy and adapt an open-source application. The page therefore serves two connected intentions: understand the sales workflow, then inspect/run the source. It does not offer a hosted subscription signup.

This ICP is a working positioning hypothesis grounded in the requested workflows. It is not a customer-interview or market-size finding. Validate it through conversations and usage before claiming traction or performance outcomes.

The previous heading named follow-ups and context but left the reader to infer the actual job. The new heading names the daily decision. Supporting copy connects the person, conversation and product; feature copy explains the owner/deadline, product separation, meeting preparation and keyboard workflow. MCP follows the sales benefits and explains useful reads and consent. The open-source section spells out deployment choice, source modification and control over assistant access under Apache-2.0.

The primary CTA is **Run Gravity locally**, pointing to actual setup steps; **View on GitHub** is secondary. A separate **Explore the preview** link sits with the fictional workflow illustration. This matches the project's current release stage and makes the action predictable. The final CTA repeats the setup path. Metadata explicitly names open-source CRM and founder-led sales, with a 47-character title including the brand and a 152-character description.

## Primary-source review

| Page reviewed | Observed emphasis | Decision for Gravity |
|---|---|---|
| [Attio](https://attio.com/) | Contextual CRM data, agents and revenue workflows, product illustration, developer ecosystem. | Show the relationship and next action together. Explain the assistant boundary instead of promising autonomous outcomes. |
| [Twenty](https://twenty.com/) | Customizable enterprise CRM building blocks for technical teams; open-source community and product demonstrations. | Give developers source and setup links while leading with the user's daily workflow. |
| [HubSpot CRM](https://www.hubspot.com/products/crm) | Accessible CRM setup for smaller businesses and an integrated customer platform; concrete feature explanations and learning resources. | Provide a readable starting guide and answer setup questions without suggesting a hosted free tier exists. |
| [Salesforce Sales](https://www.salesforce.com/sales/) | Seller productivity with agents, enterprise customer proof, demos and trials. | Keep claims proportional to the working foundation. Avoid invented customer logos, usage numbers and performance outcomes. |
| [Close](https://close.com/) | Calling, email, messages and automation close to everyday sales work, with visible product and trial paths. | Explain replies and commitments plainly. Disclose that live channels and sending are unfinished. |

These are observations of public pages at the review date, not a comparative functionality, pricing or benchmark audit. Page copy can change. No competitor customer stories, screenshots or paragraphs are copied into Gravity.

## Page and content decisions

- `/welcome`: outcome-led heading, fictional workflow preview, four concrete benefits, assistant example, implemented/planned feature comparison, two original articles, FAQ and setup/source links.
- `/docs`: local setup, assistant connection and deployment readiness. Commands and authentication boundaries are explicit.
- `/blog`: original articles about contextual follow-ups and separate relationships for the same person across products. They explain the design rather than assert customer outcomes.
- Keep the established CRM at `/`. Marketing does not redirect existing workflows or inherit organization records.
- Reuse Orbit's theme variables, light/dark preference and familiar blue accent. Mobile layout collapses columns; article code scrolls within its container.
- Keep SEO opt-in. Public canonical URLs require an explicitly supplied HTTPS `PUBLIC_SITE_URL`; `PUBLIC_SITE_INDEXING=true` is effective only for production outside Vercel previews/development. Robots and sitemap expose only public content. The app, API, MCP and authentication routes retain their non-indexable behavior.

## Publication and claims

Apache-2.0 source preparation is implemented. The GitHub repository remains private at this review date; publication of the repository remains a separate release step. Public-facing copy states the license and self-hosting/modification options without mixing source access administration into the product explanation. There is no hosted sign-up promise. Gmail, LinkedIn, Calendar, Fireflies and production backup setup are labeled as unfinished. Native email/calling/SMS, autonomous sending, unrestricted API keys, multi-region delivery and production scale claims are not made.

Search relevance should come from specific articles and guides about product relationships, contextual follow-ups and OAuth assistant connections. Before public launch: select a permanent public origin, review brand/domain availability and ownership, make source visibility a deliberate decision, qualify deployment, and enable indexing for that reviewed production host.
