---
title: Secure Agent Workspace
emoji: 🛡️
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: Agent that acts with your own permissions, with approvals
---

Live demo of [Secure Agent Workspace](https://github.com/okba-bouziane/SecureAgentWorkspace): a React UI with Keycloak login, a NestJS + LangGraph.js agent that calls SecureMCP with the signed-in user's own token, human approval for writes, hybrid RAG with citations, and traces.

Everything runs in this one container: Postgres + pgvector, Redis, Keycloak, SecureMCP, the API, the ingestion worker and the web app, behind nginx. All data is sample data and resets whenever the Space restarts. Sign in with the sample accounts shown on the login page. Chat is rate limited and has daily caps to protect a free LLM quota.
