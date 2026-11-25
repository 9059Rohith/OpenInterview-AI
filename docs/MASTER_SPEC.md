
# OPENINTERVIEW AI — COMPLETE MASTER DEVELOPMENT PROMPT

## ROLE

Act as a world-class principal software engineer, full-stack developer, desktop application engineer, AI/ML engineer, UI/UX designer, security engineer, DevOps engineer, and QA engineer.

Your responsibility is to build a complete, production-ready, open-source AI interview preparation platform called **OpenInterview AI**.

Do not create only a landing page, prototype, static dashboard, or UI mockup.

Build the complete product:
- Website
- Web application
- Cross-platform desktop application
- Backend APIs
- Database
- Authentication
- AI provider integrations
- Local AI without API keys
- Resume intelligence
- Interview preparation
- Company-specific preparation
- Mock interviews
- Coding interview lab
- System design lab
- Real-time transcription
- AI notes and summaries
- Session history
- User profiles
- Subscription plans
- Razorpay integration
- Security
- Automated tests
- Documentation
- GitHub open-source release

Do not ask me questions. Make reasonable technical decisions independently.

Do not stop after writing a plan. Inspect the repository, implement the product, run it, test it, debug it, and continue until the application is functional within the available environment.

Do not claim a feature is complete unless it is actually implemented and tested.

---

# 1. PRODUCT VISION

OpenInterview AI is an affordable, privacy-first, open-source AI interview preparation platform.

It must support:
- College students
- Fresh graduates
- Job seekers
- Experienced professionals
- Software engineers
- Data scientists
- Machine learning engineers
- Product managers
- Technical and nontechnical candidates

Users should be able to:
1. Upload and analyze their resume.
2. Build their professional profile.
3. Select target companies and roles.
4. Learn interview concepts.
5. Prepare for technical interviews.
6. Practice HR and behavioral interviews.
7. Conduct AI mock interviews.
8. Practice coding questions.
9. Prepare system design answers.
10. Improve communication.
11. Identify weaknesses.
12. Generate personalized learning roadmaps.
13. Use their own AI API keys.
14. Use local AI without an API key.
15. Download and use the desktop application.

The product should be affordable, flexible, reliable, and useful throughout the entire interview journey.

Do not promise perfect AI accuracy or guaranteed job selection.

---

# 2. PRODUCT MODES

The application must have two primary modes.

## LIGHT MODE — INTERVIEW PREPARATION

Light Mode is the user's personal AI interview mentor.

It must help users:
- Learn concepts
- Prepare for interviews
- Improve resumes
- Practice technical questions
- Practice HR questions
- Conduct mock interviews
- Prepare for companies
- Practice coding
- Learn system design
- Improve communication
- Track progress
- Build personalized study plans

Light Mode should feel calm, focused, educational, and motivating.

## SHADOW MODE — REAL-TIME ASSISTANCE

Shadow Mode is a user-controlled real-time interview and conversation assistance workspace.

It must support:
- Live transcription
- Question understanding
- Context retrieval
- Resume and project context
- Document context
- Technical explanations
- Coding assistance
- System design assistance
- Notes
- Session summaries
- Transcript history

Shadow Mode must clearly display when transcription or AI assistance is active.

Implement only transparent, user-controlled workflows for practice, accessibility, permitted interviews, and productivity.

Do not implement:
- Hidden listening
- Screen-share evasion
- Process disguising
- Covert answer delivery
- Bypassing interview monitoring
- Automatic screen capture without permission

Both modes must share:
- User profile
- Resume context
- AI provider configuration
- Documents
- Session history
- Notes
- Settings
- Learning progress

Use the exact names **Light Mode** and **Shadow Mode** throughout the application.

Do not use the previous names Ram Mode or Krishna Mode anywhere in the product.

---

# 3. COMPETITOR RESEARCH

Research the publicly available product features of:

https://www.parakeet-ai.com/

Study publicly available:
- Product pages
- Features
- Documentation
- Pricing
- Workflows
- Screenshots
- Desktop application capabilities

Create:

`docs/COMPETITOR_FEATURE_MATRIX.md`

For each publicly verified feature, document:
- Feature name
- Publicly documented behavior
- Our equivalent implementation
- Improvements we can make
- Implementation status
- Testing status
- Source URL

Implement legitimate, independently developable features that are publicly documented.

Do not copy proprietary source code, branding, private APIs, copyrighted assets, or exact proprietary UI designs.

Create an original product experience.

If information is unavailable, mark it as unknown. Do not invent competitor capabilities.

---

# 4. TECHNOLOGY STACK

Use a monorepo architecture.

## Website and web application
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

## Desktop application
- Electron
- React
- TypeScript
- Electron Builder

## Backend
- Python
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic

## Database
- PostgreSQL for cloud
- SQLite for local desktop

## AI providers
- OpenAI
- Google Gemini
- Anthropic Claude
- OpenAI-compatible APIs
- Ollama local models

## Speech
- Whisper.cpp or a suitable alternative
- Voice activity detection
- Streaming transcription
- Background processing

## Infrastructure
- Redis where appropriate
- Docker Compose
- GitHub Actions

Use stable, compatible dependencies.

Document important architectural decisions.

---

# 5. REPOSITORY ARCHITECTURE

Create a clean, maintainable monorepo.

Suggested structure:

```text
OpenInterview-AI/
├── apps/
│   ├── web/
│   └── desktop/
├── services/
│   └── api/
├── packages/
│   ├── shared-types/
│   ├── ui/
│   ├── ai-router/
│   ├── provider-openai/
│   ├── provider-gemini/
│   ├── provider-claude/
│   ├── provider-compatible/
│   ├── provider-ollama/
│   ├── speech-engine/
│   ├── interview-engine/
│   ├── resume-engine/
│   ├── question-bank/
│   ├── context-manager/
│   ├── billing/
│   └── desktop-bridge/
├── infrastructure/
├── docs/
├── scripts/
├── tests/
├── .github/
├── docker-compose.yml
├── .env.example
├── README.md
└── LICENSE
```

Adjust the structure if a better architecture is justified, but maintain clear separation of concerns.

---

# 6. COMPLETE WEBSITE

Build a polished, responsive website.

Design requirements:
- Modern AI SaaS aesthetic
- Original OpenInterview AI branding
- Dark and light themes
- Premium typography
- Clear visual hierarchy
- Responsive layouts
- Accessible components
- Smooth but restrained transitions
- Professional illustrations
- Excellent empty, loading, and error states

Public pages:
1. Home
2. Features
3. Light Mode
4. Shadow Mode
5. Company Preparation
6. Question Bank
7. Coding Lab
8. System Design Lab
9. Pricing
10. Download
11. Documentation
12. Open Source
13. Security
14. Privacy
15. Terms
16. FAQ
17. Changelog
18. Contact

Authenticated pages:
1. Dashboard
2. Profile
3. Resume Manager
4. Documents
5. Interview Preparation
6. Mock Interviews
7. Question Bank
8. Coding Lab
9. System Design
10. Session History
11. Reports
12. Settings
13. AI Providers
14. Subscription
15. Billing History
16. Device Management

Every page must be functional.

Every button must perform a real action.

Every form must validate its input.

Do not create fake navigation links or nonfunctional buttons.

---

# 7. LANDING PAGE

Create a professional landing page containing:
- Hero section
- Product introduction
- Desktop download CTA
- Light Mode demonstration
- Shadow Mode demonstration
- AI provider support
- Local AI
- Resume intelligence
- Mock interview engine
- Company preparation
- Coding preparation
- System design
- Privacy and security
- Feature comparison
- Pricing
- FAQ
- Open-source information
- Footer

Use real screenshots from the application when available.

Do not publish fake testimonials, fake customer names, fake ratings, fake download counts, or false claims such as "trusted by thousands."

Use clearly labeled illustrative demo content until real user feedback and metrics exist.

---

# 8. DESKTOP DOWNLOAD WEBSITE

Build a complete download page.

Support:
- Windows
- macOS
- Linux

Features:
- Detect operating system
- Recommend the correct installer
- Allow platform selection
- Display current version
- Display release notes
- Display system requirements
- Provide checksums
- Provide installation instructions
- Link to GitHub releases

Windows:
- Installer
- Optional portable build

macOS:
- DMG
- Apple Silicon support
- Intel support where feasible

Linux:
- AppImage
- Debian package where feasible

Never link to nonexistent installers.

Use GitHub Releases or a verified release manifest.

---

# 9. GOOGLE LOGIN AND ONBOARDING

Implement secure Google OAuth.

Use:
- OAuth authorization code flow
- PKCE
- Secure redirect handling
- Short-lived access tokens
- Refresh token rotation where supported
- Session revocation

Do not collect Google passwords.

Also support local-only usage without requiring an account where practical.

Onboarding flow:
1. Welcome screen
2. Google sign-in
3. Optional local-only mode
4. Resume upload
5. Resume parsing
6. Education details
7. Skills
8. Projects
9. Internship experience
10. Target companies
11. Target job roles
12. Preferred language
13. Experience level
14. AI provider selection
15. Local model setup
16. Microphone test
17. Privacy preferences
18. Dashboard

Allow users to edit all extracted resume information.

Never invent resume details.

---

# 10. LIGHT MODE — COMPLETE INTERVIEW PREPARATION

Implement the following modules.

## A. Resume Intelligence

- PDF upload
- DOCX upload
- Resume parsing
- Skills extraction
- Experience extraction
- Project extraction
- Education extraction
- Resume quality analysis
- Resume bullet improvement
- Resume-to-job-description matching
- Resume versions
- Resume export

## B. Resume Maker

- Multiple templates
- Editable sections
- Reorder sections
- Skills editor
- Project editor
- Experience editor
- Education editor
- Resume preview
- PDF export
- DOCX export where practical
- Version history

## C. Interview Question Generator

Generate questions from:
- Resume
- Projects
- Internship experience
- Job description
- Target company
- Target role
- Skills
- Interview difficulty

Question categories:
- HR
- Behavioral
- Technical
- Coding
- Project deep dive
- System design
- SQL
- DBMS
- Operating systems
- Computer networks
- OOP
- Machine learning
- Deep learning
- Generative AI
- Leadership
- Communication

## D. Concept Teaching

Every concept should contain:
- Beginner explanation
- Intermediate explanation
- Advanced explanation
- Examples
- Visual explanations where useful
- Code examples
- Real-world applications
- Common mistakes
- Interview questions
- Practice questions
- Revision notes
- Flashcards

Support follow-up questions and adaptive explanations.

## E. Mock Interview Engine

Implement:
- HR mock interviews
- Technical mock interviews
- Coding mock interviews
- Project interviews
- System design interviews
- Behavioral interviews
- Voice interviews
- Text interviews
- Role selection
- Company selection
- Difficulty selection
- Interview duration
- Follow-up questions
- Answer recording
- Transcript
- Answer evaluation
- Interview summary
- Improvement recommendations

The AI interviewer must ask a question, wait for the user's response, evaluate it, and generate contextual follow-up questions.

## F. Answer Evaluation

Evaluate:
- Technical correctness
- Completeness
- Clarity
- Structure
- Examples
- Communication

Provide:
- Score with transparent rubric
- Missing concepts
- Improved answer
- Explanation
- Suggested practice
- Next question

Clearly distinguish AI-generated evaluation from objective test results.

## G. Personalized Learning Roadmap

- Daily study plan
- Weekly goals
- Topic completion
- Weakness detection
- Revision schedule
- Spaced repetition
- Flashcards
- Progress dashboard
- Readiness score with explainable criteria

---

# 11. COMPANY PREPARATION

Build a complete company preparation system.

Users must be able to search companies and job roles.

Company profiles may include:
- Company overview
- Available roles
- Required skills
- Interview rounds
- Public interview experiences
- Commonly reported questions
- Preparation roadmap
- Technical topics
- Behavioral topics
- Coding practice
- System design practice

Question bank fields:
- Company
- Role
- Topic
- Difficulty
- Question
- Expected concepts
- Sample answer
- Follow-up questions
- Source
- Date collected
- Confidence level

Use original questions, user-submitted experiences, public information, and properly licensed datasets.

Do not fabricate interview experiences.

Implement:
- Search
- Filters
- Sorting
- Bookmarks
- Question history
- Practice mode
- Report question
- Submit question
- Source attribution

---

# 12. CODING INTERVIEW LAB

Build a complete coding practice environment.

Features:
- Problem statement
- Constraints
- Examples
- Code editor
- Language selector
- Syntax highlighting
- Code formatting
- Test cases
- Run code
- Submit solution
- Complexity analysis
- Algorithm explanation
- Edge-case generation
- Debugging assistance
- Code review
- Interview-style explanation

Languages:
- C
- C++
- Python
- Java
- JavaScript
- TypeScript

Use secure isolated code execution.

Never execute arbitrary code directly on the main application server.

Implement:
- CPU limits
- Memory limits
- Time limits
- File access restrictions
- Network restrictions
- Container isolation or a secure execution service

Clearly distinguish tested results from AI-generated suggestions.

---

# 13. SYSTEM DESIGN LAB

Implement:
- Architecture questions
- Requirements gathering
- Functional requirements
- Nonfunctional requirements
- Capacity estimation
- API design
- Database design
- Caching
- Queues
- Load balancing
- Scalability
- Availability
- Consistency
- Security
- Trade-offs

Generate diagrams using Mermaid or an equivalent tool.

Allow:
- Diagram editing
- Diagram export
- Design notes
- Alternative architectures
- Interview practice

---

# 14. SHADOW MODE — REAL-TIME WORKSPACE

Build a responsive, user-controlled real-time assistance workspace.

Features:
- Explicit session start
- Microphone permission
- Supported system audio capture
- Audio source selection
- Voice activity detection
- Streaming speech-to-text
- Transcript segments
- Speaker labels where supported
- Question detection
- Technical question classification
- Resume context
- Project context
- Document context
- Coding assistance
- System design assistance
- AI answer generation
- AI answer explanation
- Notes
- Transcript history
- Session summary
- Session export

The interface must clearly show:
- Whether transcription is active
- Which audio source is selected
- Whether AI assistance is active
- Whether data is processed locally or remotely
- How to stop the session

Implement an asynchronous pipeline:

Audio
  -> Voice activity detection
  -> Speech recognition
  -> Question detection
  -> Context retrieval
  -> AI provider
  -> Streaming response
  -> Visible assistance panel

The UI must never freeze during transcription or AI generation.

Do not implement hidden listening, screen-share evasion, process disguising, covert answer delivery, or bypassing interview monitoring.

---

# 15. DESKTOP APPLICATION UI

The desktop application is the main product.

Use:
- Left navigation
- Main workspace
- Optional right context panel
- Fixed top-right toolbar

The top-right toolbar must remain consistent throughout the application.

Toolbar buttons:
- Mode selector: Light Mode / Shadow Mode
- Model selector
- Session control
- Microphone
- Notes
- Settings
- Help
- Account

Implement:
- Resizable panels
- Collapsible sidebar
- Keyboard shortcuts
- Dark mode
- Light theme
- Font size
- Reduced motion
- Tooltips
- Loading states
- Empty states
- Error states
- Responsive layouts

Use an original visual design.

Every button must work.

---

# 16. DOCUMENTS AND SCREENSHOTS

Support:
- PDF
- DOCX
- TXT
- Markdown
- CSV
- Images
- Code files

Implement:
- Upload
- Preview
- Text extraction
- Search
- Indexing
- Chunking
- Retrieval
- Remove
- Replace
- Permissions
- Local-only storage

Screenshot input:
- User-selected screenshot
- User-selected image
- OCR
- Image understanding
- Coding question extraction
- Diagram explanation

Never capture screens automatically without permission.

---

# 17. AI NOTES AND SESSION HISTORY

Generate session notes containing:
- Summary
- Questions asked
- Key concepts
- Important examples
- Action items
- Follow-up tasks
- Weak areas
- Suggested study topics

Session history:
- Search
- Filter
- Sort
- Rename
- Archive
- Delete
- Export
- Reopen
- Generate summary

Support Markdown export and PDF export where practical.

---

# 18. PROFESSIONAL HEADSHOT GENERATOR

Implement an optional professional headshot generator.

Features:
- User uploads their own photo
- Consent confirmation
- Professional style selection
- Background selection
- Image provider integration
- Preview
- Save
- Download
- Delete

Do not impersonate another person.

Clearly label generated images.

If no image provider is configured, display a useful setup message instead of a broken button.

---

# 19. AI PROVIDER SYSTEM

Implement provider adapters for:
- OpenAI
- Google Gemini
- Anthropic Claude
- OpenAI-compatible APIs
- Ollama local models

Every provider must implement a unified interface.

Support:
- Model listing
- Model selection
- Streaming
- Cancellation
- Timeout
- Retry
- Error handling
- Context limits
- Token estimation
- Cost estimation
- Provider health
- Model capabilities
- Vision support where available

Allow different models for:
- Interview answers
- Coding
- Resume analysis
- Transcription
- Summarization

Never assume every provider supports identical features.

Use capability detection and graceful fallback.

---

# 20. LOCAL AI WITHOUT API KEY

Integrate Ollama as the initial local model runtime.

Implement:
- Detect installation
- Detect running service
- List models
- Download model
- Show download progress
- Select model
- Start model
- Stop model
- Remove model
- Test model
- Estimate RAM requirements
- Benchmark response speed

Recommend models based on hardware.

Support CPU inference and GPU acceleration where available.

The application must remain useful without:
- API keys
- Internet
- Cloud provider access

Clearly explain that local model performance depends on the user's hardware and selected model.

---

# 21. CONTEXT OPTIMIZATION — HEADROOM

Evaluate and integrate Headroom as a context optimization layer.

Use it for:
- Long conversation compression
- Document context optimization
- Resume context optimization
- Interview history summarization
- Retrieval context reduction

Implement a modular context manager.

Features:
- Context ranking
- Token budgeting
- Deduplication
- Summarization
- Relevant context selection
- Compression evaluation

Preserve important technical facts, numbers, constraints, code, and names.

Benchmark:
- Tokens before compression
- Tokens after compression
- Latency
- Response quality

If the library is unsuitable, implement a modular alternative and document the decision.

---

# 22. OBSERVABILITY — LOGLENS

Integrate LogLens or a compatible local log-analysis workflow.

Monitor:
- Application startup
- AI provider errors
- Request latency
- Speech pipeline latency
- Model failures
- Database errors
- Authentication errors
- Payment webhook errors
- Desktop crashes

Use sanitized structured logs.

Never log:
- API keys
- OAuth tokens
- Passwords
- Resume contents
- Raw audio
- Private transcripts
- Sensitive user information

Create:

`docs/OBSERVABILITY.md`

---

# 23. PRICING

Implement configurable subscription plans.

## FREE
- Local AI
- Own API keys
- Basic resume analysis
- Basic mock interviews
- Basic question bank
- Basic coding practice
- Basic learning roadmap
- Local session history

## PLUS
- Advanced resume analysis
- Advanced mock interviews
- Detailed reports
- Multiple resume profiles
- Cloud sync
- Advanced question bank filters
- Enhanced analytics
- Additional preparation workflows

## PRO
- Advanced technical preparation
- System design lab
- Advanced coding workflows
- Full analytics
- Multiple resume profiles
- Advanced learning roadmap
- Premium organization features
- Priority support
- Early access features

Initial pricing:

India:
- Plus: ₹99/month
- Pro: ₹199/month

International:
- Plus: $1.99/month
- Pro: $3.99/month

Pricing must be configurable from the backend.

Do not promise unlimited paid cloud AI at these prices.

Local AI and user-provided API keys must not consume our cloud inference budget.

---

# 24. RAZORPAY

Integrate Razorpay.

Implement:
- Checkout
- Subscription creation
- Payment verification
- Webhook verification
- Subscription status
- Renewal
- Cancellation
- Failed payment handling
- Grace period
- Refund status
- Billing history
- Invoice records
- Plan changes

Never trust client-side payment success redirects.

Verify payments on the backend.

Verify webhook signatures.

Use idempotency for payment events.

Do not store card details.

Support sandbox/test mode.

If credentials are unavailable, implement the integration and test adapter, document setup, and continue development.

---

# 25. SECURITY AND PRIVACY

Implement security by design.

## Authentication
- OAuth PKCE
- Secure sessions
- Token expiration
- Session revocation
- Rate limiting
- Account recovery

## API keys
- OS credential vault
- Windows Credential Manager
- macOS Keychain
- Linux secret store
- Never store keys in plain text
- Never log secrets
- Never send BYOK keys to our backend

## Electron
- contextIsolation enabled
- nodeIntegration disabled
- Sandbox enabled
- Strict CSP
- Secure IPC
- Validate IPC payloads
- Restrict navigation
- Restrict permissions

## Backend
- Input validation
- Authorization on every resource
- SQL injection protection
- CSRF protection where applicable
- Secure CORS
- Rate limiting
- Secure headers
- Audit logs
- Secrets management
- Dependency scanning

## Data
- Local-first storage
- Encryption at rest
- Optional cloud sync
- Data export
- Data deletion
- Privacy settings
- Consent before cloud upload

Create:
- `docs/SECURITY.md`
- `docs/PRIVACY.md`
- `docs/THREAT_MODEL.md`

Do not claim absolute security.

Make data processing transparent and user-controlled.

---

# 26. DATABASE

Create database models and migrations for:
- Users
- User profiles
- Resumes
- Resume versions
- Projects
- Skills
- Documents
- Companies
- Roles
- Question bank
- Question sources
- Mock interviews
- Interview sessions
- Transcripts
- Session notes
- AI responses
- Learning roadmaps
- Progress records
- Bookmarks
- Subscriptions
- Payments
- Payment events
- Devices
- User preferences

Use proper:
- Primary keys
- Foreign keys
- Indexes
- Unique constraints
- Timestamps
- Soft deletion where appropriate

Implement migrations.

---

# 27. API

Implement REST APIs with OpenAPI documentation.

Required API groups:

```text
/auth
/users
/profiles
/resumes
/documents
/companies
/questions
/mock-interviews
/interview-sessions
/transcripts
/notes
/learning
/progress
/ai/providers
/ai/models
/ai/generate
/ai/stream
/billing
/subscriptions
/payments
/downloads
/health
```

Implement:
- Validation
- Authentication
- Authorization
- Pagination
- Error responses
- Rate limits
- API versioning where appropriate

Use WebSockets or an appropriate streaming protocol for real-time transcription and AI responses.

---

# 28. TESTING

Write real automated tests.

Backend:
- Unit tests
- API tests
- Authentication tests
- Authorization tests
- Billing tests
- Webhook tests
- Database tests

Frontend:
- Component tests
- Form validation tests
- Navigation tests
- State tests

Desktop:
- Startup tests
- IPC tests
- Secure storage tests
- Provider tests
- Local model tests
- Session workflow tests

End-to-end:
- Registration
- Onboarding
- Resume upload
- AI provider setup
- Local AI
- Mock interview
- Session history
- Subscription
- Payment verification
- Desktop download

Never use real secrets in tests.

---

# 29. PERFORMANCE

Optimize:
- Desktop startup
- Website loading
- AI streaming
- Speech processing
- Document indexing
- Database queries
- Local model loading

Use:
- Lazy loading
- Code splitting
- Streaming
- Background workers
- Cancellation
- Caching
- Pagination

Do not block the UI during:
- AI generation
- Model downloads
- Document parsing
- Transcription
- Report exports

Set measurable performance targets and benchmark them.

---

# 30. OPEN-SOURCE RELEASE

Prepare the project for GitHub.

Create:
- README.md
- LICENSE
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- SECURITY.md
- CHANGELOG.md
- .env.example
- Docker Compose
- GitHub issue templates
- Pull request template
- GitHub Actions workflows

Use MIT or another suitable permissive license.

Do not commit:
- API keys
- OAuth secrets
- Payment secrets
- Private certificates
- User data
- Production credentials

Document:
- Installation
- Local development
- Environment setup
- Desktop build
- AI provider setup
- Local model setup
- Database migrations
- Testing
- Deployment
- Contribution process

---

# 31. DEVELOPMENT WORKFLOW

Work autonomously.

1. Inspect the repository.
2. Create an implementation plan.
3. Create `docs/IMPLEMENTATION_STATUS.md`.
4. Implement the architecture.
5. Build the website.
6. Build the desktop application.
7. Implement AI providers.
8. Implement local AI.
9. Implement Light Mode.
10. Implement Shadow Mode.
11. Implement onboarding.
12. Implement backend and database.
13. Implement billing.
14. Implement security.
15. Implement tests.
16. Build desktop installers.
17. Run tests and fix failures.
18. Update documentation.

Do not stop after writing the plan.

Do not ask for confirmation after every milestone.

If external credentials are required:
- Implement the integration
- Add environment variables to `.env.example`
- Add setup instructions
- Add a mock/test adapter
- Continue implementing the rest

If a feature cannot be completed because of an external service, document the exact blocker.

Do not mark incomplete features as complete.

---

# 32. DEFINITION OF DONE

The project is complete only when:

1. Website builds successfully.
2. Desktop application builds successfully.
3. Backend starts successfully.
4. Database migrations run.
5. Authentication is implemented.
6. Onboarding works.
7. Resume upload works.
8. AI provider configuration works.
9. Local AI works with Ollama.
10. At least one cloud provider works with a real API key.
11. Light Mode works end-to-end.
12. Mock interviews work end-to-end.
13. Question bank works.
14. Coding lab works.
15. Shadow Mode transcription works.
16. Documents can be uploaded and retrieved.
17. Session history works.
18. Notes and summaries work.
19. Subscription entitlements work.
20. Razorpay integration is implemented.
21. Security controls are implemented.
22. Automated tests pass.
23. Desktop installers can be generated.
24. Documentation is complete.
25. No major buttons are nonfunctional.
26. No fake customer metrics are published.
27. No secrets are committed.
28. No major feature is represented only by a placeholder.

At the end, produce:
- Implementation summary
- Architecture summary
- Completed feature list
- Incomplete features
- Test results
- Build results
- Security limitations
- Required environment variables
- Local startup instructions
- Desktop build instructions
- Deployment instructions

Continue working until the application is implemented as completely as the available environment permits.

The final goal is a complete, reliable, cross-platform, open-source AI interview preparation application.

Do not deliver only a demo.

Build the actual product.
