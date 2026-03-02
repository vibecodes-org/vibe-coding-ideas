export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          github_username: string | null;
          contact_info: string | null;
          notification_preferences: {
            comments: boolean;
            votes: boolean;
            collaborators: boolean;
            status_changes: boolean;
            task_mentions: boolean;
            comment_mentions: boolean;
            email_notifications: boolean;
            collaboration_requests: boolean;
            collaboration_responses: boolean;
            discussion_mentions: boolean;
            discussions: boolean;
          };
          default_board_columns: { title: string; is_done_column: boolean }[] | null;
          is_admin: boolean;
          is_bot: boolean;
          ai_enabled: boolean;
          encrypted_anthropic_key: string | null;
          active_bot_id: string | null;
          ai_daily_limit: number;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          github_username?: string | null;
          contact_info?: string | null;
          notification_preferences?: {
            comments: boolean;
            votes: boolean;
            collaborators: boolean;
            status_changes: boolean;
            task_mentions: boolean;
            comment_mentions: boolean;
            email_notifications: boolean;
            collaboration_requests: boolean;
            collaboration_responses: boolean;
            discussion_mentions: boolean;
            discussions: boolean;
          };
          default_board_columns?: { title: string; is_done_column: boolean }[] | null;
          is_admin?: boolean;
          is_bot?: boolean;
          ai_enabled?: boolean;
          encrypted_anthropic_key?: string | null;
          active_bot_id?: string | null;
          ai_daily_limit?: number;
          onboarding_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          github_username?: string | null;
          contact_info?: string | null;
          notification_preferences?: {
            comments: boolean;
            votes: boolean;
            collaborators: boolean;
            status_changes: boolean;
            task_mentions: boolean;
            comment_mentions: boolean;
            email_notifications: boolean;
            collaboration_requests: boolean;
            collaboration_responses: boolean;
            discussion_mentions: boolean;
            discussions: boolean;
          };
          default_board_columns?: { title: string; is_done_column: boolean }[] | null;
          is_admin?: boolean;
          is_bot?: boolean;
          ai_enabled?: boolean;
          encrypted_anthropic_key?: string | null;
          active_bot_id?: string | null;
          ai_daily_limit?: number;
          onboarding_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ideas: {
        Row: {
          id: string;
          title: string;
          description: string;
          author_id: string;
          status: "open" | "in_progress" | "completed" | "archived";
          visibility: "public" | "private";
          tags: string[];
          github_url: string | null;
          upvotes: number;
          comment_count: number;
          collaborator_count: number;
          discussion_count: number;
          attachment_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description: string;
          author_id: string;
          status?: "open" | "in_progress" | "completed" | "archived";
          visibility?: "public" | "private";
          tags?: string[];
          github_url?: string | null;
          upvotes?: number;
          comment_count?: number;
          collaborator_count?: number;
          discussion_count?: number;
          attachment_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          author_id?: string;
          status?: "open" | "in_progress" | "completed" | "archived";
          visibility?: "public" | "private";
          tags?: string[];
          github_url?: string | null;
          upvotes?: number;
          comment_count?: number;
          collaborator_count?: number;
          discussion_count?: number;
          attachment_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ideas_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          id: string;
          idea_id: string;
          author_id: string;
          parent_comment_id: string | null;
          content: string;
          type: "comment" | "suggestion" | "question";
          is_incorporated: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          author_id: string;
          parent_comment_id?: string | null;
          content: string;
          type?: "comment" | "suggestion" | "question";
          is_incorporated?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          author_id?: string;
          parent_comment_id?: string | null;
          content?: string;
          type?: "comment" | "suggestion" | "question";
          is_incorporated?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_parent_comment_id_fkey";
            columns: ["parent_comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
        ];
      };
      collaborators: {
        Row: {
          id: string;
          idea_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "collaborators_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "collaborators_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      votes: {
        Row: {
          id: string;
          idea_id: string;
          user_id: string;
          type: "upvote" | "downvote";
          created_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          user_id: string;
          type?: "upvote" | "downvote";
          created_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          user_id?: string;
          type?: "upvote" | "downvote";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "votes_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "votes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      board_columns: {
        Row: {
          id: string;
          idea_id: string;
          title: string;
          position: number;
          is_done_column: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          title: string;
          position?: number;
          is_done_column?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          title?: string;
          position?: number;
          is_done_column?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_columns_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
        ];
      };
      board_tasks: {
        Row: {
          id: string;
          idea_id: string;
          column_id: string;
          title: string;
          description: string | null;
          assignee_id: string | null;
          position: number;
          due_date: string | null;
          checklist_total: number;
          checklist_done: number;
          archived: boolean;
          attachment_count: number;
          comment_count: number;
          cover_image_path: string | null;
          discussion_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          column_id: string;
          title: string;
          description?: string | null;
          assignee_id?: string | null;
          position?: number;
          due_date?: string | null;
          checklist_total?: number;
          checklist_done?: number;
          archived?: boolean;
          attachment_count?: number;
          comment_count?: number;
          cover_image_path?: string | null;
          discussion_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          column_id?: string;
          title?: string;
          description?: string | null;
          assignee_id?: string | null;
          position?: number;
          due_date?: string | null;
          checklist_total?: number;
          checklist_done?: number;
          archived?: boolean;
          attachment_count?: number;
          comment_count?: number;
          cover_image_path?: string | null;
          discussion_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_tasks_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_tasks_column_id_fkey";
            columns: ["column_id"];
            isOneToOne: false;
            referencedRelation: "board_columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_tasks_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_tasks_discussion_id_fkey";
            columns: ["discussion_id"];
            isOneToOne: false;
            referencedRelation: "idea_discussions";
            referencedColumns: ["id"];
          },
        ];
      };
      board_labels: {
        Row: {
          id: string;
          idea_id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          name: string;
          color?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          name?: string;
          color?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_labels_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
        ];
      };
      board_task_labels: {
        Row: {
          id: string;
          task_id: string;
          label_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          label_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          label_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_task_labels_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "board_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_task_labels_label_id_fkey";
            columns: ["label_id"];
            isOneToOne: false;
            referencedRelation: "board_labels";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_prompt_templates: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          prompt_text: string;
          type: "enhance" | "generate";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          prompt_text: string;
          type?: "enhance" | "generate";
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          prompt_text?: string;
          type?: "enhance" | "generate";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_prompt_templates_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      board_checklist_items: {
        Row: {
          id: string;
          task_id: string;
          idea_id: string;
          title: string;
          completed: boolean;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          idea_id: string;
          title: string;
          completed?: boolean;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          idea_id?: string;
          title?: string;
          completed?: boolean;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_checklist_items_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "board_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_checklist_items_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
        ];
      };
      board_task_activity: {
        Row: {
          id: string;
          task_id: string;
          idea_id: string;
          actor_id: string;
          action: string;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          idea_id: string;
          actor_id: string;
          action: string;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          idea_id?: string;
          actor_id?: string;
          action?: string;
          details?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_task_activity_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "board_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_task_activity_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_task_activity_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      board_task_comments: {
        Row: {
          id: string;
          task_id: string;
          idea_id: string;
          author_id: string;
          content: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          idea_id: string;
          author_id: string;
          content: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          idea_id?: string;
          author_id?: string;
          content?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_task_comments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "board_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_task_comments_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_task_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      board_task_attachments: {
        Row: {
          id: string;
          task_id: string;
          idea_id: string;
          uploaded_by: string;
          file_name: string;
          file_size: number;
          content_type: string;
          storage_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          idea_id: string;
          uploaded_by: string;
          file_name: string;
          file_size: number;
          content_type: string;
          storage_path: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          idea_id?: string;
          uploaded_by?: string;
          file_name?: string;
          file_size?: number;
          content_type?: string;
          storage_path?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "board_task_attachments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "board_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_task_attachments_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "board_task_attachments_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      idea_attachments: {
        Row: {
          id: string;
          idea_id: string;
          uploaded_by: string;
          file_name: string;
          file_size: number;
          content_type: string;
          storage_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          uploaded_by: string;
          file_name: string;
          file_size: number;
          content_type: string;
          storage_path: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          uploaded_by?: string;
          file_name?: string;
          file_size?: number;
          content_type?: string;
          storage_path?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "idea_attachments_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "idea_attachments_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          actor_id: string;
          type:
            | "comment"
            | "vote"
            | "collaborator"
            | "user_deleted"
            | "status_change"
            | "task_mention"
            | "comment_mention"
            | "collaboration_request"
            | "collaboration_response"
            | "discussion"
            | "discussion_reply"
            | "discussion_mention";
          idea_id: string | null;
          comment_id: string | null;
          task_id: string | null;
          collaboration_request_id: string | null;
          discussion_id: string | null;
          reply_id: string | null;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          actor_id: string;
          type:
            | "comment"
            | "vote"
            | "collaborator"
            | "user_deleted"
            | "status_change"
            | "task_mention"
            | "comment_mention"
            | "collaboration_request"
            | "collaboration_response"
            | "discussion"
            | "discussion_reply"
            | "discussion_mention";
          idea_id?: string | null;
          comment_id?: string | null;
          task_id?: string | null;
          collaboration_request_id?: string | null;
          discussion_id?: string | null;
          reply_id?: string | null;
          read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          actor_id?: string;
          type?:
            | "comment"
            | "vote"
            | "collaborator"
            | "user_deleted"
            | "status_change"
            | "task_mention"
            | "comment_mention"
            | "collaboration_request"
            | "collaboration_response"
            | "discussion"
            | "discussion_reply"
            | "discussion_mention";
          idea_id?: string | null;
          comment_id?: string | null;
          task_id?: string | null;
          collaboration_request_id?: string | null;
          discussion_id?: string | null;
          reply_id?: string | null;
          read?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "board_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_collaboration_request_id_fkey";
            columns: ["collaboration_request_id"];
            isOneToOne: false;
            referencedRelation: "collaboration_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_discussion_id_fkey";
            columns: ["discussion_id"];
            isOneToOne: false;
            referencedRelation: "idea_discussions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_reply_id_fkey";
            columns: ["reply_id"];
            isOneToOne: false;
            referencedRelation: "idea_discussion_replies";
            referencedColumns: ["id"];
          },
        ];
      };
      mcp_oauth_clients: {
        Row: {
          client_id: string;
          client_secret: string;
          redirect_uris: string[];
          client_name: string | null;
          created_at: string;
        };
        Insert: {
          client_id?: string;
          client_secret: string;
          redirect_uris: string[];
          client_name?: string | null;
          created_at?: string;
        };
        Update: {
          client_id?: string;
          client_secret?: string;
          redirect_uris?: string[];
          client_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      mcp_oauth_codes: {
        Row: {
          code: string;
          client_id: string;
          user_id: string;
          redirect_uri: string;
          code_challenge: string;
          code_challenge_method: string;
          supabase_access_token: string;
          supabase_refresh_token: string;
          scope: string;
          expires_at: string;
          used: boolean;
          created_at: string;
        };
        Insert: {
          code: string;
          client_id: string;
          user_id: string;
          redirect_uri: string;
          code_challenge: string;
          code_challenge_method?: string;
          supabase_access_token: string;
          supabase_refresh_token: string;
          scope?: string;
          expires_at?: string;
          used?: boolean;
          created_at?: string;
        };
        Update: {
          code?: string;
          client_id?: string;
          user_id?: string;
          redirect_uri?: string;
          code_challenge?: string;
          code_challenge_method?: string;
          supabase_access_token?: string;
          supabase_refresh_token?: string;
          scope?: string;
          expires_at?: string;
          used?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_codes_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "mcp_oauth_clients";
            referencedColumns: ["client_id"];
          },
        ];
      };
      bot_profiles: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          role: string | null;
          system_prompt: string | null;
          avatar_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          owner_id: string;
          name: string;
          role?: string | null;
          system_prompt?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          role?: string | null;
          system_prompt?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bot_profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bot_profiles_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      collaboration_requests: {
        Row: {
          id: string;
          idea_id: string;
          requester_id: string;
          status: "pending" | "accepted" | "declined";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          requester_id: string;
          status?: "pending" | "accepted" | "declined";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          requester_id?: string;
          status?: "pending" | "accepted" | "declined";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "collaboration_requests_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "collaboration_requests_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage_log: {
        Row: {
          id: string;
          user_id: string;
          action_type: "enhance_description" | "generate_questions" | "enhance_with_context" | "generate_board_tasks" | "enhance_task_description" | "enhance_discussion_body";
          input_tokens: number;
          output_tokens: number;
          model: string;
          key_type: "platform" | "byok";
          idea_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          action_type: "enhance_description" | "generate_questions" | "enhance_with_context" | "generate_board_tasks" | "enhance_task_description" | "enhance_discussion_body";
          input_tokens?: number;
          output_tokens?: number;
          model: string;
          key_type: "platform" | "byok";
          idea_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          action_type?: "enhance_description" | "generate_questions" | "enhance_with_context" | "generate_board_tasks" | "enhance_task_description" | "enhance_discussion_body";
          input_tokens?: number;
          output_tokens?: number;
          model?: string;
          key_type?: "platform" | "byok";
          idea_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_usage_log_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
        ];
      };
      idea_discussions: {
        Row: {
          id: string;
          idea_id: string;
          author_id: string;
          title: string;
          body: string;
          status: "open" | "resolved" | "ready_to_convert" | "converted";
          pinned: boolean;
          upvotes: number;
          reply_count: number;
          last_activity_at: string;
          target_column_id: string | null;
          target_assignee_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          author_id: string;
          title: string;
          body: string;
          status?: "open" | "resolved" | "ready_to_convert" | "converted";
          pinned?: boolean;
          upvotes?: number;
          reply_count?: number;
          last_activity_at?: string;
          target_column_id?: string | null;
          target_assignee_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          author_id?: string;
          title?: string;
          body?: string;
          status?: "open" | "resolved" | "ready_to_convert" | "converted";
          pinned?: boolean;
          upvotes?: number;
          reply_count?: number;
          last_activity_at?: string;
          target_column_id?: string | null;
          target_assignee_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "idea_discussions_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "idea_discussions_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "idea_discussions_target_column_id_fkey";
            columns: ["target_column_id"];
            isOneToOne: false;
            referencedRelation: "board_columns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "idea_discussions_target_assignee_id_fkey";
            columns: ["target_assignee_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      idea_discussion_replies: {
        Row: {
          id: string;
          discussion_id: string;
          author_id: string;
          content: string;
          parent_reply_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          discussion_id: string;
          author_id: string;
          content: string;
          parent_reply_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          discussion_id?: string;
          author_id?: string;
          content?: string;
          parent_reply_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "idea_discussion_replies_discussion_id_fkey";
            columns: ["discussion_id"];
            isOneToOne: false;
            referencedRelation: "idea_discussions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "idea_discussion_replies_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "idea_discussion_replies_parent_reply_id_fkey";
            columns: ["parent_reply_id"];
            isOneToOne: false;
            referencedRelation: "idea_discussion_replies";
            referencedColumns: ["id"];
          },
        ];
      };
      discussion_votes: {
        Row: {
          id: string;
          discussion_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          discussion_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          discussion_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "discussion_votes_discussion_id_fkey";
            columns: ["discussion_id"];
            isOneToOne: false;
            referencedRelation: "idea_discussions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "discussion_votes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      feedback: {
        Row: {
          id: string;
          user_id: string;
          category: "bug" | "suggestion" | "question" | "other";
          content: string;
          page_url: string | null;
          status: "new" | "reviewed" | "archived";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          category: "bug" | "suggestion" | "question" | "other";
          content: string;
          page_url?: string | null;
          status?: "new" | "reviewed" | "archived";
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          category?: "bug" | "suggestion" | "question" | "other";
          content?: string;
          page_url?: string | null;
          status?: "new" | "reviewed" | "archived";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      idea_agents: {
        Row: {
          id: string;
          idea_id: string;
          bot_id: string;
          added_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          idea_id: string;
          bot_id: string;
          added_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          idea_id?: string;
          bot_id?: string;
          added_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "idea_agents_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "idea_agents_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bot_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "idea_agents_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_delete_user: {
        Args: { target_user_id: string };
        Returns: undefined;
      };
      get_public_stats: {
        Args: Record<string, never>;
        Returns: Json;
      };
      create_bot_user: {
        Args: {
          p_name: string;
          p_owner_id: string;
          p_role?: string | null;
          p_system_prompt?: string | null;
          p_avatar_url?: string | null;
        };
        Returns: string;
      };
      delete_bot_user: {
        Args: {
          p_bot_id: string;
          p_owner_id: string;
        };
        Returns: undefined;
      };
      update_bot_user: {
        Args: {
          p_bot_id: string;
          p_owner_id: string;
          p_name?: string | null;
          p_avatar_url?: string | null;
        };
        Returns: undefined;
      };
    };
    Enums: {
      idea_status: "open" | "in_progress" | "completed" | "archived";
      idea_visibility: "public" | "private";
      comment_type: "comment" | "suggestion" | "question";
      vote_type: "upvote" | "downvote";
      notification_type:
        | "comment"
        | "vote"
        | "collaborator"
        | "user_deleted"
        | "status_change"
        | "task_mention"
        | "comment_mention"
        | "collaboration_request"
        | "collaboration_response"
        | "discussion"
        | "discussion_reply"
        | "discussion_mention";
      collaboration_request_status: "pending" | "accepted" | "declined";
      discussion_status: "open" | "resolved" | "ready_to_convert" | "converted";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
