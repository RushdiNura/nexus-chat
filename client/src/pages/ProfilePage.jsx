import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ImagePlus,
  LoaderCircle,
  Mail,
  MapPin,
  Save,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import assets from "../assets/assets";
import AuthContext from "../context/AuthContext";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

function ProfilePage() {
  const { authUser, updateProfile } = useContext(AuthContext);
  const navigate = useNavigate();
  const [selectedImg, setSelectedImg] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [name, setName] = useState(authUser?.fullName || "");
  const [bio, setBio] = useState(authUser?.bio || "");
  const [email, setEmail] = useState(authUser?.email || "");
  const [location, setLocation] = useState(authUser?.location || "");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setName(authUser?.fullName || "");
    setBio(authUser?.bio || "");
    setEmail(authUser?.email || "");
    setLocation(authUser?.location || "");
  }, [authUser?._id, authUser?.fullName, authUser?.bio, authUser?.email, authUser?.location]);

  useEffect(() => {
    if (!selectedImg) {
      setPreviewUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(selectedImg);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImg]);

  const getImageSource = (imageUrl) => {
    if (!imageUrl) return assets.avatar_icon;
    if (imageUrl.startsWith("http") || imageUrl.startsWith("data:")) return imageUrl;
    const backendUrl = String(import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");
    return `${backendUrl}/${imageUrl.replace(/^\//, "")}`;
  };

  const displayImage = previewUrl || getImageSource(authUser?.profilePic);

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      toast.error("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }
    setSelectedImg(file);
  };

  const handleImageError = (event) => {
    event.currentTarget.onerror = null;
    event.currentTarget.src = assets.avatar_icon;
  };

  async function handleSubmit(event) {
    event.preventDefault();
    if (isLoading) return;
    const cleanName = name.trim();
    const cleanBio = bio.trim();
    const cleanLocation = location.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      toast.error("Your name must be between 2 and 80 characters.");
      return;
    }
    if (cleanBio.length > 300) {
      toast.error("Your bio must be 300 characters or fewer.");
      return;
    }
    if (cleanLocation.length > 100) {
      toast.error("Location must be 100 characters or fewer.");
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        fullName: cleanName,
        bio: cleanBio,
        location: cleanLocation,
      };
      if (selectedImg) payload.profilePic = await fileToDataUrl(selectedImg);
      const saved = await updateProfile(payload);
      if (saved) navigate("/");
    } catch (error) {
      toast.error(error?.message || "Your profile couldn't be saved.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="nx-profile-page">
      <div className="nx-profile-shell">
        <header className="nx-profile-topbar">
          <div className="nx-profile-heading-group">
            <button type="button" className="nx-profile-back" onClick={() => navigate("/")} aria-label="Back to chats" title="Back to chats">
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="nx-profile-breadcrumb">NEXUSCHAT <span>/</span> SETTINGS</div>
              <h1>Profile settings</h1>
              <p>Manage how you appear to people you chat with.</p>
            </div>
          </div>
          <div className="nx-profile-secure-label"><ShieldCheck size={15} /> Your account</div>
        </header>

        <div className="nx-profile-layout">
          <section className="nx-profile-form-card" aria-labelledby="nx-profile-form-title">
            <div className="nx-profile-card-heading">
              <span className="nx-profile-eyebrow">PERSONAL DETAILS</span>
              <h2 id="nx-profile-form-title">Edit your profile</h2>
              <p>Keep your details current so friends can recognize you.</p>
            </div>

            <form className="nx-profile-form" onSubmit={handleSubmit}>
              <div className="nx-profile-photo-row">
                <div className="nx-profile-avatar-wrap">
                  <img src={displayImage} alt="Your profile" onError={handleImageError} className="nx-profile-avatar" />
                  <label htmlFor="nx-profile-avatar-upload" className="nx-profile-camera-button" title="Choose profile photo" aria-label="Choose profile photo">
                    <Camera size={16} />
                  </label>
                </div>
                <div className="nx-profile-photo-copy">
                  <strong>Profile photo</strong>
                  <p>Choose a clear photo that your contacts will recognize.</p>
                  <label htmlFor="nx-profile-avatar-upload" className="nx-profile-upload-button"><ImagePlus size={15} /> Choose photo</label>
                  <input id="nx-profile-avatar-upload" className="nx-profile-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} />
                  <span className="nx-profile-helper">PNG, JPG or WEBP · Up to 5 MB</span>
                </div>
              </div>

              <div className="nx-profile-fields-grid">
                <label className="nx-profile-field">
                  <span>Full name <i>*</i></span>
                  <div className="nx-profile-input-wrap"><UserRound size={16} aria-hidden="true" /><input autoComplete="name" type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="Your name" /></div>
                </label>
                <label className="nx-profile-field">
                  <span>Email address</span>
                  <div className="nx-profile-input-wrap is-readonly"><Mail size={16} aria-hidden="true" /><input autoComplete="email" type="email" value={email} readOnly disabled /></div>
                  <small>Email is linked to your account and can't be changed here.</small>
                </label>
                <label className="nx-profile-field nx-profile-field-full">
                  <span>Location</span>
                  <div className="nx-profile-input-wrap"><MapPin size={16} aria-hidden="true" /><input autoComplete="address-level2" type="text" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={100} placeholder="City or region (optional)" /></div>
                </label>
              </div>

              <label className="nx-profile-field nx-profile-bio-field">
                <span>About you</span>
                <textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={4} maxLength={300} placeholder="A little about yourself…" />
                <div className="nx-profile-bio-footer"><small>Share a short introduction with your contacts.</small><span>{bio.length}/300</span></div>
              </label>

              <div className="nx-profile-form-footer">
                <button type="button" className="nx-profile-cancel-button" onClick={() => navigate("/")} disabled={isLoading}><X size={15} /> Cancel</button>
                <button type="submit" className="nx-profile-save-button" disabled={isLoading || !name.trim()}>{isLoading ? <><LoaderCircle className="nx-profile-spin" size={16} /> Saving…</> : <><Save size={16} /> Save changes</>}</button>
              </div>
            </form>
          </section>

          <aside className="nx-profile-preview-card" aria-label="Live profile preview">
            <div className="nx-profile-preview-heading"><span className="nx-profile-eyebrow">LIVE PREVIEW</span><span className="nx-profile-preview-status"><i /> Preview</span></div>
            <div className="nx-profile-preview-surface">
              <div className="nx-profile-preview-cover"><span className="nx-profile-cover-dot" /><span className="nx-profile-cover-line" /></div>
              <div className="nx-profile-preview-body">
                <img src={displayImage} alt="Profile preview" onError={handleImageError} className="nx-profile-preview-avatar" />
                <div className="nx-profile-preview-name-row"><h2>{name.trim() || "Your name"}</h2><CheckCircle2 size={16} aria-label="Profile preview" /></div>
                <p className="nx-profile-preview-email">{email || "your@email.com"}</p>
                {location.trim() && <p className="nx-profile-preview-location"><MapPin size={13} /> {location.trim()}</p>}
                <div className="nx-profile-preview-divider" />
                <span className="nx-profile-preview-about-label">ABOUT</span>
                <p className="nx-profile-preview-bio">{bio.trim() || "Your introduction will appear here."}</p>
              </div>
            </div>
            <div className="nx-profile-preview-note"><ShieldCheck size={15} /><p>Your profile details are shared with people you interact with on NexusChat.</p></div>
          </aside>
        </div>
        <footer className="nx-profile-page-footer"><span>© NexusChat</span><span>Profile & account settings</span></footer>
      </div>
    </main>
  );
}

export default ProfilePage;
