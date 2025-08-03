# 🚀 AI-Powered SQL Terminal Editor


A sophisticated SQL terminal interface with intelligent AI integration, built with Next.js, TypeScript, and PostgreSQL. Features user-specific schema isolation, real-time AI query generation, and a terminal-like experience.

## ✨ Key Features

### 🤖 Advanced AI Integration
- **Two-Stage AI Workflow**: Intelligent table identification followed by context-aware SQL generation
- **Complete Data Awareness**: AI analyzes existing data to prevent primary key conflicts
- **Agentic SQL Generation**: Uses meta-llama/llama-4-scout-17b-16e-instruct for intelligent query creation
- **Command Array Execution**: Guaranteed sequential execution of all generated SQL commands

### 🔒 Security & Isolation
- **User-Specific Schema Isolation**: Each user operates in their own PostgreSQL schema
- **Automatic Schema Management**: CREATE SCHEMA and SET search_path handled automatically
- **Cross-User Privacy**: Users can only access their own tables and data
- **SQL Injection Protection**: Parameterized queries and input validation

### 💻 Terminal Experience
- **Authentic Terminal Interface**: Black/white theme with green success and red error messages
- **Command History Navigation**: Up arrow shows previous commands (MySQL/SQLPlus style)
- **Real-time Execution**: Live feedback with loading states and execution progress
- **Multi-line SQL Support**: Handle complex queries with proper line numbering

### 🎯 Smart Query Features
- **Intelligent Table Discovery**: AI identifies relevant tables for each request
- **Primary Key Conflict Prevention**: Analyzes existing data to generate safe INSERT statements
- **Context-Aware Responses**: AI understands table relationships and data patterns
- **Fallback Mechanisms**: Robust error handling with intelligent fallbacks

## 🏗️ Architecture

### AI Workflow (Two-Stage Process)

The system uses a sophisticated two-stage AI workflow:

1. **Stage 1: Table Identification**
   - AI analyzes user prompt and available tables
   - Returns relevant table names or empty array for table creation
   - Uses conservative approach to avoid unnecessary table access

2. **Stage 2: SQL Generation with Full Context**
   - Retrieves complete schema and ALL existing data for identified tables
   - AI generates SQL commands with full awareness of existing primary keys
   - Prevents conflicts by using next available ID values

### Database Schema Isolation

```
PostgreSQL Database
├── user1_schema
│   ├── users (id: 1,2,3)
│   └── products (id: 1,2)
├── user2_schema
│   ├── orders (id: 1,2,3,4)
│   └── customers (id: 1,2)
└── user3_schema
    └── inventory (id: 1,2,3)
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database (Neon recommended)
- GROQ API key for AI features

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd sqleditor
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Setup**
Create a `.env.local` file:
```env
DATABASE_URL=postgresql://username:password@host:port/database
GROQ_API_KEY=your_groq_api_key_here
```

4. **Run the development server**
```bash
npm run dev
```

5. **Open your browser**
Navigate to [http://localhost:3000](http://localhost:3000)

## 🎮 Usage Guide

### Authentication
1. Register a new account or login with existing credentials
2. Each user gets their own isolated PostgreSQL schema
3. Schema name is automatically sanitized (e.g., `user@email.com` → `user_email_com`)

### Basic SQL Commands
```sql
-- Create a table
CREATE TABLE users (id SERIAL PRIMARY KEY, name VARCHAR(100), email VARCHAR(100));

-- Insert data
INSERT INTO users (name, email) VALUES ('John Doe', 'john@example.com');

-- Query data
SELECT * FROM users;

-- Show your tables
SHOW TABLES;
```

### AI Commands
Use the `/ai` prefix for intelligent SQL generation:

```bash
# Show all data
SQL> /ai show me all my data

# Create tables
SQL> /ai create a products table with id, name, price, and description

# Insert data (AI prevents primary key conflicts)
SQL> /ai add 5 new users to my users table

# Complex queries
SQL> /ai find all users whose email contains gmail and show their names

# Table operations
SQL> /ai show me the schema of my users table
```

### Command History
- **Up Arrow**: Navigate to previous commands
- **Down Arrow**: Navigate to next commands
- **Enter**: Execute current command
- **clear scr**: Clear the terminal screen

## 🔧 Technical Implementation

### Core Components

#### 1. AI Agent (`lib/ai-agent.ts`)
- **Two-stage workflow**: Table identification → SQL generation
- **Complete data context**: Retrieves all table data, not just schemas
- **Primary key intelligence**: Analyzes existing values to prevent conflicts
- **Command validation**: Ensures all generated commands are executable

#### 2. Schema Introspection (`lib/schema-introspection.ts`)
- **Complete data retrieval**: Gets all rows from tables (not just samples)
- **Primary key analysis**: Identifies highest values and next available IDs
- **Comprehensive formatting**: Provides rich context for AI decision-making

#### 3. SQL Executor (`lib/sql-executor.ts`)
- **Schema isolation**: Automatic SET search_path management
- **Transaction support**: Multi-statement execution in single transaction
- **Error handling**: Detailed PostgreSQL error parsing and user-friendly messages

#### 4. Terminal Interface (`components/sql-terminal.tsx`)
- **Real-time execution**: Live feedback with loaders and progress indicators
- **Command history**: MySQL/SQLPlus-style navigation
- **Multi-line support**: Handle complex SQL with proper formatting

### AI Workflow Details

#### Stage 1: Table Identification
```typescript
// Input: User prompt + available tables
// Output: Array of relevant table names or empty array
const relevantTables = await identifyRelevantTables(allTables, userPrompt);
```

#### Stage 2: SQL Generation with Full Context
```typescript
// Input: User prompt + complete schema + all existing data
// Output: Array of executable SQL commands
const sqlCommands = await generateSQLWithAgent(username, prompt);
```

### Primary Key Conflict Prevention

The AI receives detailed information about existing data:
```
EXISTING DATA (3 rows):
  {"id": 1, "name": "John", "email": "john@example.com"}
  {"id": 2, "name": "Jane", "email": "jane@example.com"}
  {"id": 3, "name": "Bob", "email": "bob@example.com"}

CRITICAL: Highest primary key values: {"id": 3}
CRITICAL: Next available primary key values should start from: {"id": 4}
```

This ensures the AI generates:
```sql
INSERT INTO users (id, name, email) VALUES (4, 'Alice', 'alice@example.com'), (5, 'Charlie', 'charlie@example.com');
```

## 🛠️ API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login

### SQL Operations
- `POST /api/sql/execute` - Execute SQL queries
- `POST /api/sql/get-tables` - Get user's tables

### AI Integration
- `POST /api/ai/agent` - AI-powered SQL generation

## 🎨 Customization

### Theme Configuration
The terminal supports theme customization in `components/sql-terminal.tsx`:
- **Background**: Black (`bg-black`)
- **Text**: White (`text-white`)
- **Success**: Green-500 (`text-green-500`)
- **Error**: Red-400 (`text-red-400`)
- **Loader**: Lucide React spinner with `animate-spin`

### AI Model Configuration
Modify the AI model in `lib/ai-agent.ts`:
```typescript
model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
temperature: 0.1, // Lower = more consistent
maxTokens: 4096
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Primary Key Conflicts
**Problem**: `duplicate key value violates unique constraint`
**Solution**: The new AI workflow should prevent this by analyzing existing data

#### 2. Schema Access Denied
**Problem**: `Access denied: You can only access your own schema`
**Solution**: Ensure you're not trying to access other users' schemas

#### 3. AI Generation Failures
**Problem**: AI fails to generate SQL commands
**Solution**: Check GROQ_API_KEY and fallback mechanisms activate

#### 4. Database Connection Issues
**Problem**: Connection timeouts or failures
**Solution**: Verify DATABASE_URL and network connectivity

### Debug Mode
Enable detailed logging by setting:
```env
NODE_ENV=development
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Next.js** - React framework for production
- **Neon** - Serverless PostgreSQL platform
- **GROQ** - AI inference platform
- **Meta Llama** - Large language model for SQL generation
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Beautiful icon library

---

## Author

[Subhadeep Roy](https://x.com/mvp_Subha)

---

**Built with ❤️ for developers who love SQL and AI**
