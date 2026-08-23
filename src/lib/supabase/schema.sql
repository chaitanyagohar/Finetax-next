-- 1. ENUMS FOR ROLES AND WORKFLOW STAGES
CREATE TYPE user_role AS ENUM ('admin', 'staff', 'reviewer');
CREATE TYPE task_stage AS ENUM ('Assigned', 'In Progress', 'Submitted for Review', 'Changes Required', 'Approved');
CREATE TYPE lead_status AS ENUM ('New', 'Follow Up', 'Converted', 'Lost');
CREATE TYPE quote_status AS ENUM ('Draft', 'Sent', 'Accepted', 'Rejected');
CREATE TYPE task_category AS ENUM ('GST', 'Income Tax', 'Audit', 'ROC', 'Other');

-- 2. USERS & GRANULAR PERMISSIONS
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role user_role DEFAULT 'staff',
  permissions JSONB DEFAULT '{"leads": true, "tasks": true, "billing": false, "time_tracking": true}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CLIENT MANAGEMENT & INTELLIGENCE
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  status TEXT DEFAULT 'Active',
  total_revenue NUMERIC(12,2) DEFAULT 0.00,
  risk_level TEXT DEFAULT 'Low', -- Low, Medium, High Workload, At-Risk
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. LEADS & ENQUIRIES
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  service TEXT NOT NULL,
  status lead_status DEFAULT 'New',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SERVICE PACKAGES (REPEATABLE WORKFLOW TEMPLATES)
CREATE TABLE service_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  base_price NUMERIC(10,2) NOT NULL,
  task_templates JSONB NOT NULL, -- Array of default task titles, sequence, due offsets
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TASKS & REVIEW WORKFLOW
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES profiles(id),
  reviewer_id UUID REFERENCES profiles(id),
  category task_category DEFAULT 'Other',
  stage task_stage DEFAULT 'Assigned',
  due_date DATE,
  description TEXT,
  review_comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. DIGITAL OFFICE LOG SHEET (TIME TRACKING)
CREATE TABLE time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. QUOTATIONS & INVOICES
CREATE TABLE quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  date DATE DEFAULT CURRENT_DATE,
  items JSONB NOT NULL, -- [{desc, qty, price}]
  subtotal NUMERIC(10,2) NOT NULL,
  tax NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  status quote_status DEFAULT 'Sent',
  invoice_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  invoice_number TEXT UNIQUE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'Unpaid',
  issue_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SYSTEM AUDIT TRAIL
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);