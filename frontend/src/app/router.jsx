import { NavigationDepthTracker } from '@/app/NavigationDepthTracker';
import { AppShell } from '@/components/layout/AppShell';
import { EditProfile } from '@/pages/EditProfile';
import { Home } from '@/pages/Home';
import { PostDetail } from '@/pages/PostDetail';
import { Profile } from '@/pages/Profile';
import { SignIn } from '@/pages/SignIn';
import { SignOut } from '@/pages/SignOut';
import { SignUp } from '@/pages/SignUp';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';
import { Navigate, Route, Routes } from 'react-router';

export function AppRouter() {
  return (
    <NavigationDepthTracker>
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/sign-up" element={<SignUp />} />
        </Route>
        <Route path="/sign-out" element={<SignOut />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/u/:username" element={<Profile />} />
            {/* A distinct, longer path: ranked separately from /u/:username, no overlap. */}
            <Route path="/u/:username/posts/:id" element={<PostDetail />} />
            <Route path="/settings/profile" element={<EditProfile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </NavigationDepthTracker>
  );
}
