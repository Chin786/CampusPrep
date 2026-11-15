export type UserRole = 'student' | 'content_author' | 'admin' | 'super_admin'

export type Profile = {
  id: string
  full_name: string
  email: string
  roll_no: string
  phone: string
  role: UserRole
  status: 'pending' | 'approved' | 'rejected' | 'blocked'
}
export type State =
  | 'not_visited'
  | 'not_answered'
  | 'answered'
  | 'marked'
  | 'answered_marked'
export type Item = {
  question_id: string
  section: string
  section_pos: number
  position: number
  prompt: string
  options: string[]
  image_url: string | null
  marks: number
  negative_marks: number
  selected_index: number | null
  status: State
  rev: number
}
export type Paper = {
  id: string
  title: string
  status: string
  remaining_seconds: number
  warning_count: number
  warning_limit: number
  fullscreen: boolean
  seb: boolean
  items: Item[]
}
export type Schedule = {
  id: string
  test_id: string
  start_at: string
  end_at: string
  paper_title: string
  paper_description: string
  paper_instructions: string
  paper_duration_min: number
  paper_total_marks: number
  review_after_close: boolean
  late_entry_min: number
  max_warnings: number
  require_fullscreen: boolean
  require_seb: boolean
}
export type Test = {
  id: string
  title: string
  description: string
  duration_min: number
  total_marks: number
  instructions: string
  is_demo: boolean
  status: string
}
