## Verification Commands
<!-- Managed by /quorum:init-pipeline. Keep in sync with .claude/hooks/verify-completion.sh, which runs the fast checks. -->
- **Setup:** {{SETUP}}
- **Build:** {{BUILD}}
- **Typecheck:** {{TYPECHECK}}
- **Lint:** {{LINT}}
- **Test:** {{TEST}}
- **Dev / start:** {{DEV}}

## Code Review & Verification Standards
All code reviews, subagent audits, and `/quorum:review-loop` passes MUST strictly follow the domain failure modes, severity tags, and learned rules defined in @REVIEW.md.
