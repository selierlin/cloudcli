import { useEffect, type ReactNode } from 'react';

import { IS_PLATFORM } from '../../../shared/utils';
import { dismissSplash } from '../../../utils/splash';
import { useAuth } from '../context/AuthContext';
import Onboarding from '../../onboarding/view/Onboarding';

import AuthLoadingScreen from './AuthLoadingScreen';
import LoginForm from './LoginForm';
import SetupForm from './SetupForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, needsSetup, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  // 认证完成后的「主界面分支」判定：无 loading 且已通过 setup / 登录 / 引导。
  const isContentBranch =
    !isLoading &&
    (IS_PLATFORM
      ? hasCompletedOnboarding
      : Boolean(user && hasCompletedOnboarding && !needsSetup));

  // 认证完成后的非主界面分支（登录 / 设置 / 引导）不再有独立 loading，
  // 立即移除启动 splash 让界面可见；主界面分支交给 AppContent 在内容 ready 时处理。
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
