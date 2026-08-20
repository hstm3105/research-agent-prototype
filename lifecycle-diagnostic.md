# ResearchOS Lifecycle Diagnostic

## Scope

The diagnostic covered intake, session navigation, depth selection, planning, clarification, streamed execution, public-source recovery, persistence, exports, and resumed sessions.

| Lifecycle area | Finding | Current behavior |
|---|---|---|
| Startup and navigation | The home page was automatically selecting the latest session, hiding the composer and depth selector. | Resolved: startup now remains in fresh-composer mode until the user explicitly opens a session. |
| New research | Starting a new brief needed to terminate any retained stream context. | Resolved: New Research closes a stream, clears active state, focuses the composer, and restores Standard depth. |
| Depth selection | The control was conditional on fresh-composer mode, so it was invisible behind an auto-opened session. | Resolved: Quick Summary, Standard, and Deep Dive are visible in the default intake and persist with a new session. |
| Clarification | Stream handlers could read values from an older render. | Resolved: clarification and activity updates now use functional state updates rather than captured state. |
| Session selection | Selecting a history item opens its saved evidence deliberately; execution resumes only from the explicit Run Research or Try Again action. | Confirmed intentional behavior. |
| Source recovery | Narrow queries can return no attributable results. | Confirmed: the individual step is marked skipped and the plan continues. |
| Analysis recovery | Model analysis can be temporarily unavailable after sources were collected. | Confirmed: direct source-backed fallback findings preserve the run. |
| Persistence and export | Sessions, plans, sources, findings, and exports are user-scoped. | Confirmed: exports are only presented once a session is complete. |

## Validation

The full automated suite covers initial composer visibility, depth selection, agent plan depth, clarification streaming, clarification resume, adaptive planning, sparse-source handling, storage, exports, and user-scoped session access.
