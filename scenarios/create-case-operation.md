# Create-case operation acceptance checks

These checks refine [new-case intake](new-case.md) against the proposed
[operation contract](../model/create-case.md). They are not executable tests or
passed results. Run through the native-form adapter and each custom client as
available, plus direct API attempts. Use only synthetic records and isolated
request IDs; test with ordinary authorized and unauthorized users.

| Check | Action | Required observation |
| --- | --- | --- |
| Minimum | Existing person/client role, opening status and explicit timestamp | One case, participant, opening event and receipt; stable IDs; no identifier |
| Complete | Add compatible case context and complete primary identifier | One identifier; links and initial status/client/date/reference values agree |
| Optional values | Compare omitted and null optional fields | Empty source values, no defaults silently added |
| Partial identifier | Omit each required identifier input in turn | Rejected with field feedback; no records committed; false primary is accepted |
| Invalid shape | Unknown property, forged actor/sequence, unsupported version, timestamp without offset | Rejected before effects |
| Reference validation | Inaccessible person, wrong role context, invalid opening status, incompatible office | Rejected without exposing inaccessible record details |
| Actor/configuration | Missing/ambiguous identity mapping or missing required configuration | No records committed; safe configuration error |
| Trusted history | Supply valid request | Actor is signed-in mapped user; recording timestamp is server supplied; opening sequence is 1 |
| Atomic failure | Inject failure after each prospective child/receipt write | No partial case, participant, event, identifier or successful receipt |
| Replay | Submit same ID and normalized content again | Original IDs/time returned; counts unchanged |
| Equivalent input | Replay with reordered fields, equivalent timestamp offset or null/omitted optionals | Same result, no duplicate |
| Conflict | Reuse committed ID with changed person/status/identifier | Conflict; original facts unchanged |
| Concurrent replay | Send identical request simultaneously from two clients as same caller | One aggregate and one successful receipt; both resolve same IDs |
| Concurrent conflict | Same key with differing content | At most one payload commits; other conflicts after outcome resolution |
| Unknown response | Lose response after commit; lookup/retry same key | Resolve original result; no second aggregate |
| In-flight lookup | Lookup before another attempt commits | Not-observed response does not cause a replacement ID; eventual outcome resolves |
| Failed correction | Correct definitively rejected request with no receipt, retaining key | Corrected submission can succeed exactly once |
| Scope | Another user guesses key or loses access after creation | No unauthorized receipt/result/case disclosure |
| Bypass | Directly create incomplete Case or forged lifecycle event outside entry path | Ordinary caller blocked; no bypass through import/API |
| History protection | Ordinary user edits/deletes created lifecycle history | Rejected independently of disabled form controls |
| Time | Equivalent instants around reporting-date boundary and daylight-saving transitions | UTC history preserved; reporting date uses configured zone |
| Native form behavior | Double-click Save, autosave, Save & Close, refresh/back | No unintended/duplicate creation; success navigation and errors remain usable |

After each run, inspect domain records and receipt counts independently of UI
messages. A rollback test must not count post-failure cleanup as atomicity.
Keep request evidence until the run is reviewed. Record actual results in
`docs/case-intake-ui-comparison.md`; offline schema checks cannot prove this table.
