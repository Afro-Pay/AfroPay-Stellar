# Local Development Setup Guide

This guide provides a comprehensive step-by-step workflow to configure and run the AfroPay-Stellar ecosystem locally across all polyglot microservices.

---

## 🏗️ System Prerequisites

Ensure you have the following global dependencies installed on your machine:
* **Node.js**: v18.0.0 or higher
* **Rust**: v1.70.0+
* **Python**: v3.10 or v3.11
* **Docker & Docker Compose**

---

## ⚡ Step 1: Infrastructure Initialization (Database & Cache)

1. Navigate to the root directory and start the infrastructure containers:
   ```bash
   docker-compose up -d postgres redis