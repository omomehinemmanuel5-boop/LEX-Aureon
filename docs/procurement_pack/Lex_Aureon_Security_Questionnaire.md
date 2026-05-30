# Lex Aureon Security Questionnaire (Enterprise)
**Version:** 1.0  
**Updated:** April 28, 2026

> Positioning note: responses reflect SOC 2 readiness-oriented controls unless otherwise stated. Do not interpret as SOC 2 attestation unless separately provided.

## Governance, Risk, and Compliance
1. **Q:** Do you maintain a formal information security program?  
   **A:** Yes. Lex Aureon operates a documented security program with governance ownership, control cataloging, and periodic review cycles.
2. **Q:** Is there executive oversight for security?  
   **A:** Yes. Security governance includes leadership-level accountability and risk reporting.
3. **Q:** Do you maintain security policies?  
   **A:** Yes. Core policies include access control, incident response, data handling, change management, and vendor risk.
4. **Q:** Are policies reviewed at least annually?  
   **A:** Yes, or upon material control changes.
5. **Q:** Do you perform risk assessments?  
   **A:** Yes. Risk assessments are conducted periodically and after significant architecture changes.
6. **Q:** Do you maintain a risk register?  
   **A:** Yes. Risks are tracked with ownership, treatment, and review cadence.
7. **Q:** Are employees trained on security and privacy?  
   **A:** Yes. Mandatory onboarding and periodic reinforcement training are required.
8. **Q:** Is background screening conducted where legally permissible?  
   **A:** Yes, subject to regional legal constraints.

## Access Control and Identity
9. **Q:** Do you enforce least privilege access?  
   **A:** Yes. Access is role-based and scope-limited by business need.
10. **Q:** Is MFA required for privileged access?  
    **A:** Yes, for administrative and high-risk accounts.
11. **Q:** Do you support SSO federation?  
    **A:** Yes. SAML/OIDC support is available for enterprise tenants.
12. **Q:** Are access requests approved and documented?  
    **A:** Yes. Access follows approval workflow and is auditable.
13. **Q:** Are access rights reviewed periodically?  
    **A:** Yes. Access recertification occurs on a defined cadence.
14. **Q:** Are dormant accounts disabled?  
    **A:** Yes, according to account lifecycle controls.
15. **Q:** Are service credentials rotated?  
    **A:** Yes. Rotation intervals are defined by credential type and risk.
16. **Q:** Is privileged activity logged?  
    **A:** Yes. Administrative actions are captured in audit logs.

## Infrastructure and Network Security
17. **Q:** Is data encrypted in transit?  
    **A:** Yes. TLS is used for data in transit.
18. **Q:** Is data encrypted at rest?  
    **A:** Yes. Storage encryption is enabled for supported data stores.
19. **Q:** Do you segment production and non-production environments?  
    **A:** Yes. Environment separation is enforced by architecture and access policy.
20. **Q:** Do you use infrastructure-as-code or reproducible deployment controls?  
    **A:** Yes. Deployment workflows are controlled and traceable.
21. **Q:** Is outbound internet access from production restricted?  
    **A:** Controlled by service requirements and monitored per environment.
22. **Q:** Are network boundaries monitored?  
    **A:** Yes. Telemetry and alerting are configured for anomalous patterns.
23. **Q:** Are backups performed?  
    **A:** Yes. Backup and restore procedures exist for critical control data.
24. **Q:** Is disaster recovery planning documented?  
    **A:** Yes. DR expectations and operational recovery procedures are documented.

## Application Security
25. **Q:** Do you follow secure SDLC practices?  
    **A:** Yes. Secure development includes review, testing, and controlled release.
26. **Q:** Is code review required before merge?  
    **A:** Yes. Changes are peer-reviewed under branch protection.
27. **Q:** Do you scan dependencies for vulnerabilities?  
    **A:** Yes. Dependency monitoring and remediation workflows are in place.
28. **Q:** Do you perform static analysis?  
    **A:** Yes, in CI/CD pipelines where configured.
29. **Q:** Are security tests performed before release?  
    **A:** Yes. Security checks are part of release readiness criteria.
30. **Q:** Are secrets prohibited from source code repositories?  
    **A:** Yes. Secrets management controls and scanning are used.
31. **Q:** Is change management tracked?  
    **A:** Yes. Releases and change tickets are recorded with audit trail.
32. **Q:** Do you maintain vulnerability remediation SLAs?  
    **A:** Yes. Remediation timelines are risk-severity based.

## Data Protection and Privacy
33. **Q:** Do you support data minimization?  
    **A:** Yes. Configurable payload minimization and selective logging controls are available.
34. **Q:** Can customers define retention policies?  
    **A:** Yes. Retention is tenant-configurable within service constraints.
35. **Q:** Do you support data deletion workflows?  
    **A:** Yes. Deletion requests are supported per contractual terms and legal obligations.
36. **Q:** Do you support GDPR rights workflows?  
    **A:** Yes. Operational support for access, deletion, and processing controls is available.
37. **Q:** Are subprocessors contractually bound to security obligations?  
    **A:** Yes. Subprocessors are bound by contractual data protection and security terms.
38. **Q:** Do you maintain records of processing activities?  
    **A:** Yes, where required by law and service operations.
39. **Q:** Are cross-border transfer safeguards available?  
    **A:** Yes. Transfer mechanisms can be implemented where required.
40. **Q:** Is personal data used to train foundation models by default?  
    **A:** No. Lex Aureon processing is purpose-bound to governance services unless explicitly agreed.

## AI Governance and Output Safety
41. **Q:** What does Lex Aureon govern?  
    **A:** It governs model outputs via policy evaluation, transformation, blocking, or escalation.
42. **Q:** Can you block sensitive output leakage?  
    **A:** Yes. Policy controls support detection and blocking/redaction of sensitive content patterns.
43. **Q:** Can policies apply by business unit or tenant?  
    **A:** Yes. Policies can be scoped per tenant/environment/domain.
44. **Q:** Are policy changes versioned?  
    **A:** Yes. Policy versions are tracked with change history.
45. **Q:** Is human-in-the-loop escalation supported?  
    **A:** Yes. High-risk outputs can be routed for manual review.
46. **Q:** Can you enforce legal or compliance disclaimers?  
    **A:** Yes. Output transforms can append or enforce required language.
47. **Q:** Do you support model-agnostic governance?  
    **A:** Yes. The control plane is designed to sit between application and LLM providers.
48. **Q:** Can governance actions be audited later?  
    **A:** Yes. Decision evidence is captured with traceable IDs.
49. **Q:** Do you log prompts and outputs by default?  
    **A:** Configurable. High-sensitivity modes can minimize stored payload content while retaining evidence metadata.
50. **Q:** Do you claim guaranteed legal compliance from AI outputs?  
    **A:** No. Lex Aureon materially reduces risk but cannot alone guarantee legal compliance outcomes.

## Logging, Monitoring, and Incident Response
51. **Q:** Is centralized logging implemented?  
    **A:** Yes. Security and governance events are centralized for monitoring.
52. **Q:** Are logs time-synchronized?  
    **A:** Yes. Standardized timestamps are used for event correlation.
53. **Q:** Can logs be exported to SIEM?  
    **A:** Yes. Integration/export options are available.
54. **Q:** Is anomalous behavior monitored?  
    **A:** Yes. Detection and alerting workflows support operational response.
55. **Q:** Do you maintain an incident response plan?  
    **A:** Yes. Incident processes include containment, investigation, notification, and recovery.
56. **Q:** Are customers notified of relevant security incidents?  
    **A:** Yes. Notification is provided per contractual and legal obligations.
57. **Q:** Is evidence preserved for post-incident analysis?  
    **A:** Yes. Audit trails and investigation artifacts are retained per policy.
58. **Q:** Do you conduct post-incident reviews?  
    **A:** Yes. Corrective actions are tracked through closure.

## Legal, Procurement, and Assurance
59. **Q:** Do you provide a DPA?  
    **A:** Yes. A standard DPA template is available for procurement review.
60. **Q:** Do you provide security architecture documentation?  
    **A:** Yes. A one-page architecture brief and security whitepaper are available.
61. **Q:** Are penetration tests performed?  
    **A:** Security testing practices are employed; detailed reports and cadence may be shared under NDA where available.
62. **Q:** Do you maintain cyber insurance?  
    **A:** Available by contracting entity and region; confirmation can be provided during procurement.
63. **Q:** Can you support customer-specific control mappings?  
    **A:** Yes. We can map controls to common frameworks during enterprise onboarding.
64. **Q:** Can you support AI governance committee reporting?  
    **A:** Yes. Audit exports and policy metrics can support governance reviews.

---
For buyer review, this questionnaire should be read with the Lex Aureon Security Whitepaper and DPA.
