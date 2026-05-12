export interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  dateOfBirth?: string;
  country?: string;
  timezone?: string;
  dnd?: boolean;
  dndSettings?: { sms?: { status: string }; email?: { status: string }; call?: { status: string } };
  customFields?: Array<{ id: string; value: unknown }>;
  dateAdded?: string;
}

export interface GhlConversation {
  id: string;
  contactId: string;
  type?: string;
  dateAdded?: string;
}

export interface GhlMessage {
  id: string;
  body?: string;
  type?: number; // 1=TYPE_SMS, 2=TYPE_EMAIL, etc.
  direction?: string; // 'inbound' | 'outbound'
  dateAdded?: string;
  status?: string;
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string; position: number }>;
}

export interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string; // 'open', 'won', 'lost', 'abandoned'
  monetaryValue?: number;
  contact?: { id: string };
  dateAdded?: string;
}

export interface GhlCustomField {
  id: string;
  name: string;
  dataType: string;
  placeholder?: string;
  position?: number;
  picklistOptions?: string[];
}

export interface GhlCalendar {
  id: string;
  name: string;
  description?: string;
}

export interface GhlCalendarEvent {
  id: string;
  title?: string;
  startTime?: string; // ISO8601
  endTime?: string; // ISO8601
  contactId?: string;
  calendarId?: string;
  status?: string; // 'confirmed', 'cancelled', 'no-show', 'completed'
}

export interface GhlNote {
  id: string;
  body: string;
  contactId: string;
  dateAdded?: string;
}

export interface GhlTask {
  id: string;
  title: string;
  body?: string;
  contactId: string;
  dueDate?: string;
  completed?: boolean;
  dateAdded?: string;
}

export interface GhlFile {
  id: string;
  name: string;
  url: string;
  contactId: string;
  dateAdded?: string;
}

export interface GhlMeta {
  nextPageUrl?: string;
  startAfter?: string;
  startAfterId?: string;
  total?: number;
}

export interface GhlApiResponse<T> {
  data: T;
  meta?: GhlMeta;
}
