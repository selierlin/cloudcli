import { useEffect, type ReactNode } from 'react';

import { IS_PLATFORM } from '@/shared/utils';
import { useAuth } from '@/modules/auth/context/AuthContext';
import { Onboarding } from '@/modules/onboarding';
import AuthLoadingScreen from '@/modules/auth/AuthLoadingScreen';
import LoginForm from '@/modules/auth/LoginForm';
import SetupForm from '@/modules/auth/SetupForm';
import { dismissSplash } from '@/utils/splash';

type ProtectedRouteProps = {
  children: ReactNode;
};

/** Used by App to gate the routed application behind setup, login and onboarding. */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, needsSetup, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  // 认证完成后的「主界面分支」判定：无 loading 且已通过 setup / 登录 / 引导。
  const isContentBranch =
    !isLoading &&
    (IS_PLATFORM
      ? hasCompletedOnboarding
      : Boolean(user && hasCompletedOnboarding && !needsSetup));

  // 认证完成后的非主界面分支（登录 / 设置 / 引导）不再有独立 loading，
  // 立即移除启动 splash 让界面可见；主界面分支交给主内容在项目加载完成时处理。
  useEffect(() => {
    if (!isLoading && !isContentBranch) {
      dismissSplash();
    }
  }, [isLoading, isContentBranch]);

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return <Onboarding onComplete={refreshOnboardingStatus} />;
    }

    return <>{children}</>;
  }

  if (needsSetup) {
    return <SetupForm />;
  }

  if (!user) {
    return <LoginForm />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
