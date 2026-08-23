export type UserRole = 'admin' | 'staff' | 'reviewer';

export type TaskStage = 
  | 'Assigned' 
  | 'In Progress' 
  | 'Submitted for Review' 
  | 'Changes Required' 
  | 'Approved';

export type TaskCategory = 'GST' | 'Income Tax' | 'Audit' | 'ROC' | 'Other';

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  permissions: Record<string, boolean>;
  created_at?: string;
}

export interface Client {
  id: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  status: 'Active' | 'Inactive';
  total_revenue: number;
  risk_level: 'Low' | 'Medium' | 'High Workload' | 'At-Risk';
  created_at?: string;
}

export interface Lead {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  service: string;
  status: 'New' | 'Follow Up' | 'Converted' | 'Lost';
  notes?: string;
  created_at?: string;
}

export interface QuotationItem {
  desc: string;
  qty: number;
  price: number;
}

export interface Quotation {
  id: string;
  client_id?: string;
  client_name: string;
  phone?: string;
  email?: string;
  date: string;
  valid_until?: string;
  items: QuotationItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected';
  created_by?: string;
  created_at?: string;
}

export interface Task {
  id: string;
  title: string;
  client_id: string;
  client_name?: string;
  assigned_to?: string;
  reviewer_id?: string;
  category: TaskCategory;
  stage: TaskStage;
  due_date: string;
  description?: string;
  review_comments?: string;
  created_at?: string;
}

export interface TimeLog {
  id: string;
  task_id: string;
  user_id: string;
  client_id: string;
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  notes?: string;
  created_at?: string;
}

export interface ServicePackage {
  id: string;
  title: string;
  description: string;
  base_price: number;
  task_templates: Array<{
    title: string;
    category: TaskCategory;
    daysToComplete: number;
  }>;
  created_at?: string;
}