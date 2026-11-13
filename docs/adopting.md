# Adopting and customizing this project

For organizations considering using or adapting this project. Start with the
[README](../README.md) for what the project is and how to try it.

## Recommended steps

1. **Start from the shared specification, not an implementation.** Read
   [the product definition](PRODUCT.md), the [model](../model/README.md) and
   the [acceptance scenarios](../scenarios/). Walk through your current process
   against the scenarios. Where your process differs, write a new synthetic
   scenario first, so the difference is recorded before any code changes.
2. **Use the Postgres/AWS prototype as the starting point for a working
   system.** It covers invoice upload and import, line-by-line review with
   questions and sign-off, rates, pre-authorizations, case matching and an
   external submitter portal. Use the Dataverse prototype only to judge how
   the data model fits Power Platform. If your organization uses Microsoft
   services, the [Microsoft platform plan](microsoft-platform-plan.md)
   compares two options. Running the app as it is on Azure needs the fewest
   changes. Moving its data into Dataverse is a larger change, worth it only
   if the data must live there (for example, to share it with other Power
   Platform apps).
3. **Answer the organizational and technical questions before you build.**
   Work through the [organizational questions](#questions-for-your-organization)
   with program, billing and records staff, and the
   [technical questions](#technical-questions) with your IT team. Their answers
   set the configuration, the hosting choice and the cost estimate your
   organization will need to approve.
4. **Plan how it fits your case management system.** Decide whether to run
   this tool beside it or build these features into it. See
   [the integration guide](integration.md).
5. **Customize through configuration, not code.** Most policy differences are
   meant to be reference data or settings rather than code changes. In the
   Postgres/AWS prototype these include rates by role and by person, counties
   and other settings, pre-authorization thresholds, review settings such as
   time log checks, review reason lists and named sign-off approvers. If a
   requirement can't be expressed that way, add it to the model as a general,
   configurable rule. Don't hard-code one organization's policy.
6. **Keep the specification authoritative.** When behavior changes, update the
   model, the scenarios and the affected implementation's mapping together,
   and record each decision in [DECISIONS.md](DECISIONS.md).
7. **Keep your organization's details out of the shared repository.** Real
   names, jurisdictions, codes, thresholds, invoices and research notes belong
   in your own deployment configuration and database, never in fixtures,
   documentation or commit history.
8. **Pilot in stages.** Start with the synthetic demo data, then try a small
   group of real users and invoices in a separate environment. Keep demo
   sign-in and demo reset turned off anywhere real data is stored, because
   reseeding deletes application data.
9. **Contribute generic improvements back.** Strip out anything specific to
   your organization first; see [CONTRIBUTING.md](../CONTRIBUTING.md).


## Questions for your organization

Policy and process decisions the software can't make for you. Many become
configuration; some decide whether the tool fits at all.

**Process fit**

- Do the [acceptance scenarios](../scenarios/) match how invoices arrive and are
  reviewed and approved? Where do they differ?
- Which system owns cases and people: this one or your case management
  system? Will time still be recorded there?
- Should invoices be filed by the person who billed them and matched to a case
  during review, or filed under a known case from the start?
- Who reviews, and who signs off: anyone on staff or named approvers? Must
  someone other than the person who entered a request finish its review, and
  above what amount?
- How will payment completion be recorded, given payment happens elsewhere?

**Billing policy**

- What are the rates by role and by person, and from what dates?
- How are travel time, waiting time, mileage and travel costs billed? Should
  mileage be checked against driving distance?
- Which services need pre-authorization? What thresholds apply in each county,
  and how are overruns handled?
- Can one supplier invoice be split across requests or cases?

**Roles and access**

- Which roles exist, and what can each see and do? Who sees sensitive notes?
- Who can submit for someone else, such as office support staff?
- Who can add people, providers, organizations and counties?

**Records and accountability**

- Which statuses do you use? Who can correct records, and can dates be
  backdated? Which time zone do reports use?
- What must submitters attest to, and what signature assurance is needed?
- How long is each record kept? Must finished invoices go to a records or
  document management system?
- Which funding sources, programs and reports must be supported?

**Ownership**

- Who owns the product and its configuration after launch? Who trains and
  supports users?

All open product decisions are listed in
[the model review](model-review.md#product-decisions-still-required).


## Technical questions

For your IT team. The answers decide where the system runs and what it costs.

**Hosting and cost**

- Which cloud providers and accounts can be used, including government clouds?
  Who pays for and operates them?
- Are there data residency, encryption or authorization-to-operate
  requirements?
- What is the monthly cost, including per-request services?
- If you use Microsoft services: can the app be hosted on Azure (Azure
  Government for a government tenant), or must the data be in Dataverse?
  Azure is the smaller change.
- Only if Dataverse is required: which Power Platform licenses and how much
  capacity? See [the Microsoft platform plan](microsoft-platform-plan.md#questions-to-answer-before-building).

**Identity and email**

- Which identity provider will staff use?
- How will external submitters sign in: the app's emailed codes or an external
  identity service?
- Which service sends sign-in codes and notifications?

**Integrations**

- How will cases, people and approved invoices move between this system and
  your case management, finance and document management systems: exports, APIs
  or by hand? See [the integration guide](integration.md).
- Should review questions and emailed answers be tied to your mail system,
  such as Outlook, so the emails are kept with the invoice? The prototype
  doesn't do this yet. See
  [email and mailbox integration](integration.md#email-and-mailbox-integration).
- Should the mileage check call a mapping service? It's billed per request.
- PDFs are read inside the server. Is that enough, or is a separate extraction
  service worth its cost?

**Operations and assurance**

- Which environments are needed, and who promotes changes between them?
- Who handles backups, restores, monitoring, updates and incidents?
- Which security review and accessibility standard (such as WCAG 2.1 AA) must
  it pass before launch?
