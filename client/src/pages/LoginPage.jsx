// client/src/pages/LoginPage.jsx
import React, { useContext, useState } from "react";
// import { useNavigate } from "react-router-dom";
import assets from "../assets/assets";
import AuthContext from "../context/AuthContext";

function LoginPage() {
  const [currentState, setCurrentState] = useState("Login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bio, setBio] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
 

  const {login} = useContext(AuthContext);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (currentState === "Sign up" && !isSubmitted) {
      setIsSubmitted(true);
      return;
    }
    
    login(currentState === 'Sign up' ? "signup" : "login",{fullName,email,password,bio})
  };

  return (
    <div className="nx-auth-page min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-1/4 -right-20 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 w-full max-w-6xl">
        {/* Left - Branding */}
        <div className="flex flex-col items-center md:items-start text-center md:text-left mb-8 md:mb-0">
          <div className="nx-auth-brand-lockup mb-5">
            <img src={assets.logo_icon} alt="" className="nx-auth-brand-icon" />
            <div>
              <h1 className="nx-auth-brand-name">nexuschat</h1>
              <p className="nx-auth-brand-tagline">MESSAGES, MADE HUMAN</p>
            </div>
          </div>
          <p className="text-slate-600 text-lg max-w-md">
            Connect with friends and colleagues through seamless, secure
            messaging.
          </p>
        </div>

        {/* Right - Form */}
        <div className="w-full max-w-md">
          <form
            onSubmit={handleSubmit}
            className="bg-slate-900/70 backdrop-blur-xl border border-purple-500/30 rounded-3xl p-8 flex flex-col gap-6 shadow-2xl"
          >
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-2xl font-bold text-white">
                {currentState === "Sign up" && !isSubmitted
                  ? "Create Account"
                  : currentState === "Sign up" && isSubmitted
                  ? "Complete Profile"
                  : "Welcome Back"}
              </h2>
              <div
                onClick={() => {
                  setCurrentState(
                    currentState === "Login" ? "Sign up" : "Login"
                  );
                  setIsSubmitted(false);
                }}
                className="text-purple-400 hover:text-purple-300 cursor-pointer transition-colors duration-300 text-sm flex items-center gap-1"
              >
                {currentState === "Login" ? (
                  <>
                    Sign up
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </>
                ) : (
                  <>
                    Login
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </>
                )}
              </div>
            </div>

            {currentState === "Sign up" && !isSubmitted && (
              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full Name"
                    required
                    className="w-full bg-slate-800/50 border border-purple-500/20 rounded-xl py-3 px-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all duration-300"
                  />
                </div>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email Address"
                    required
                    className="w-full bg-slate-800/50 border border-purple-500/20 rounded-xl py-3 px-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all duration-300"
                  />
                </div>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="w-full bg-slate-800/50 border border-purple-500/20 rounded-xl py-3 px-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all duration-300"
                  />
                </div>
              </div>
            )}

            {currentState === "Sign up" && isSubmitted && (
              <div className="space-y-4">
                <div className="relative">
                  <textarea
                    value={bio}
                    rows={4}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full bg-slate-800/50 border border-purple-500/20 rounded-xl py-3 px-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all duration-300 resize-none"
                    placeholder="Tell us a bit about yourself..."
                    required
                  />
                </div>
              </div>
            )}

            {currentState === "Login" && (
              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email Address"
                    required
                    className="w-full bg-slate-800/50 border border-purple-500/20 rounded-xl py-3 px-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all duration-300"
                  />
                </div>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="w-full bg-slate-800/50 border border-purple-500/20 rounded-xl py-3 px-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all duration-300"
                  />
                </div>
                <div className="text-right">
                  <a
                    href="#"
                    className="text-purple-400 hover:text-purple-300 text-sm transition-colors duration-300"
                  >
                    Forgot password?
                  </a>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25"
            >
              {currentState === "Sign up" && !isSubmitted
                ? "Continue"
                : currentState === "Sign up" && isSubmitted
                ? "Complete Profile"
                : "Login to Account"}
            </button>

            {currentState === "Sign up" && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  id="terms"
                  required
                  className="w-4 h-4 text-purple-600 bg-slate-800 border-purple-500/30 rounded focus:ring-purple-500/50"
                />
                <label htmlFor="terms" className="cursor-pointer">
                  I agree to the{" "}
                  <a href="#" className="text-purple-400 hover:text-purple-300">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#" className="text-purple-400 hover:text-purple-300">
                    Privacy Policy
                  </a>
                </label>
              </div>
            )}

            {currentState === "Login" && (
              <div className="text-center text-sm text-slate-400">
                Don't have an account?{" "}
                <span
                  onClick={() => setCurrentState("Sign up")}
                  className="text-purple-400 hover:text-purple-300 cursor-pointer font-medium transition-colors duration-300"
                >
                  Sign up here
                </span>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
