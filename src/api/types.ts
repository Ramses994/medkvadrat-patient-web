export type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: string;
  error_details?: { code: string; message: string };
};

export type OtpRequestResult = {
  request_id: string;
  ttl: number;
  message: string;
};

export type PatientCandidate = {
  patient_id: number;
  full_name: string;
  masked_email: string;
};

export type TokenPair = {
  access: string;
  access_expires_in: number;
  session?: string;
  refresh?: string;
  refresh_expires_in?: number;
};

export type OtpVerifyResult = TokenPair & {
  patient_candidates?: PatientCandidate[];
};

export type Profile = {
  patient_id: number;
  full_name: string;
  phone: string;
  email: string;
  birth_date?: string;
  birth_year?: number;
};

export type Branch = {
  id: number;
  name: string;
  address?: string | null;
};

export type Doctor = {
  id: number;
  name: string;
};

export type Appointment = {
  planning_id: number;
  starts_at: string;
  duration_min: number;
  state: string;
  is_waitlist: boolean;
  branch?: Branch | null;
  doctor?: Doctor | null;
  exam_name?: string | null;
  confirmation?: string | null;
};

export type RuntimeConfig = {
  clinic_phone: string;
};
