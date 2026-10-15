export type UserRole = 'admin' | 'staff' | 'reviewer';

export type TaskStage = 
  | 'Assigned' 
  | 'In Progress' 
  | 'Submitted for Review' 
  | 'Changes Required' 
  | 'Approved';

export type TaskCategory = 'GST' | 'Income Tax' | 'Audit' | 'ROC' | 'Other';

/** Current pipeline statuses plus legacy values still present in older rows */
export type LeadStatus =
  | 'New'
  | 'Contacted'
  | 'Qualified'
  | 'Quotation Sent'
  | 'Won'
  | 'Lost'
  | 'Follow Up'
  | 'Converted';

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  permissions?: Record<string, boolean>;
  phone?: string;
  designation?: string;
  is_reviewer?: boolean;
  is_active?: boolean;
  module_access?: string[];
  status?: string;
  created_at?: string;
}

export interface Client {
  id: string;
  name: string;
  organization_name?: string;
  type?: string;
  contact_person?: string;
  pan?: string;
  gstin?: string;
  phone?: string;
  email?: string;
  address?: string;
  state?: string;
  status?: string;
  assigned_to?: string;
  notes?: string;
  service_requested?: string;
  lead_source?: string;
  total_revenue?: number;
  pending_revenue?: number;
  risk_level?: 'Low' | 'Medium' | 'High Workload' | 'At-Risk';
  created_at?: string;
}

export interface Lead {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  service?: string;
  service_requested?: string;
  organization_name?: string;
  company?: string;
  source?: string;
  referred_by?: string;
  referring_client_id?: string;
  status: LeadStatus;
  assigned_to?: string;
  follow_up_date?: string;
  estimated_value?: number;
  notes?: string;
  converted_client_id?: string;
  conversion_date?: string;
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