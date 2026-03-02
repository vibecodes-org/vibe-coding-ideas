"use client";

import { useRef, useState } from "react";
import { Camera, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateProfile } from "@/actions/profile";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";
import type { User } from "@/types";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

interface EditProfileDialogProps {
  user: User;
}

export function EditProfileDialog({ user }: EditProfileDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentAvatarUrl = user.avatar_url;
  const initials = getInitials(user.full_name);

  // Determine what to show in the avatar preview
  const displayAvatarUrl = removeAvatar
    ? undefined
    : previewUrl ?? currentAvatarUrl ?? undefined;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error("Image must be 2MB or less");
      return;
    }

    setSelectedFile(file);
    setRemoveAvatar(false);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function handleRemoveAvatar() {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setRemoveAvatar(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function resetAvatarState() {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setRemoveAvatar(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(formData: FormData) {
    setIsPending(true);
    try {
      // Handle avatar upload/removal
      if (selectedFile) {
        const supabase = createClient();
        const filePath = `${user.id}/avatar`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(filePath, selectedFile, {
            upsert: true,
            cacheControl: "3600",
          });

        if (uploadError) {
          toast.error("Failed to upload avatar");
          return;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("avatars").getPublicUrl(filePath);

        formData.set("avatar_url", `${publicUrl}?t=${Date.now()}`);
      } else if (removeAvatar) {
        formData.set("avatar_url", "");
      }

      await updateProfile(formData);
      resetAvatarState();
      setOpen(false);
      toast.success("Profile updated");
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) resetAvatarState();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Pencil className="h-4 w-4" />
          Edit Profile
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>
            Update your profile information visible to other users.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <div
              className="group relative cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Avatar className="h-20 w-20">
                <AvatarImage src={displayAvatarUrl} />
                <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="h-6 w-6 text-white" />
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Change photo
              </Button>
              {(currentAvatarUrl || selectedFile) && !removeAvatar && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveAvatar}
                >
                  <X className="mr-1 h-3 w-3" />
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="full_name" className="text-sm font-medium">
              Display Name
            </label>
            <Input
              id="full_name"
              name="full_name"
              defaultValue={user.full_name ?? ""}
              placeholder="Your name"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="bio" className="text-sm font-medium">
              Bio
            </label>
            <Textarea
              id="bio"
              name="bio"
              defaultValue={user.bio ?? ""}
              placeholder="A short bio about yourself"
              rows={3}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="github_username" className="text-sm font-medium">
              GitHub Username
            </label>
            <Input
              id="github_username"
              name="github_username"
              defaultValue={user.github_username ?? ""}
              placeholder="your-username"
              maxLength={39}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="contact_info" className="text-sm font-medium">
              Contact Info
            </label>
            <Input
              id="contact_info"
              name="contact_info"
              defaultValue={user.contact_info ?? ""}
              placeholder="Discord, Twitter, email, etc."
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              How others can reach you privately to discuss ideas.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
