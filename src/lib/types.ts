// Row types for the shared Supabase schema (kept in sync with the mobile app's
// migrations in La-Kala/supabase/migrations).

export type AdminRole = 'super_admin' | 'content_manager' | 'support';

export interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  role: AdminRole;
  created_at: string;
}

export type LessonType = 'quiz' | 'video' | 'audio';

export interface Chapter {
  id: string;
  title: string;
  description: string | null;
  order_index: number;
  created_at: string;
}

export interface Lesson {
  id: string;
  chapter_id: string;
  type: LessonType;
  title: string;
  order_index: number;
  xp_value: number;
  media_url: string | null;
  description: string | null;
  duration_seconds: number | null;
}

export interface QuizOption {
  id: string; // 'a' | 'b' | 'c' | 'd'
  label: string; // 'A' | 'B' | 'C' | 'D'
  text: string;
}

export interface QuizQuestion {
  id: string;
  lesson_id: string;
  category: string | null;
  question: string;
  options: QuizOption[];
  correct_answer: string;
  order_index: number;
}

export interface Badge {
  id: string;
  code: string;
  title: string;
  description: string | null;
  icon_key: string;
  icon_url: string | null;
  bg_color: string;
  requirement_type: 'total_xp' | 'streak' | 'lessons_completed' | 'perfect_quizzes';
  requirement_value: number;
  is_active: boolean;
}

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  learning_goal: string | null;
  total_xp: number;
  current_streak: number;
  badges_count: number;
  created_at: string;
}

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'hate_speech'
  | 'sexual_content'
  | 'misinformation'
  | 'other';

export interface Post {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
  hidden_at: string | null;
  hidden_by: string | null;
  hidden_reason: string | null;
}

export interface PostReport {
  id: string;
  post_id: string;
  reporter_id: string;
  reason: ReportReason;
  details: string | null;
  status: 'open' | 'actioned' | 'dismissed';
  created_at: string;
}

export type SubscriptionPlan = 'free' | 'monthly' | 'yearly' | 'lifetime';
export type SubscriptionStatus = 'active' | 'trial' | 'canceled' | 'expired';

export interface Subscription {
  id: string;
  user_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  started_at: string;
  expires_at: string | null;
  updated_at: string;
}
