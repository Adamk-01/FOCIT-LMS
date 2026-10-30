import React, { createContext, useContext, useState, useMemo } from 'react';

const ExamLockContext = createContext({
  isExamLocked: false,
  setExamLocked: () => {},
});

export function ExamLockProvider({ children }) {
  const [isExamLocked, setExamLocked] = useState(false);

  const value = useMemo(
    () => ({ isExamLocked, setExamLocked }),
    [isExamLocked]
  );

  return (
    <ExamLockContext.Provider value={value}>
      {children}
    </ExamLockContext.Provider>
  );
}

export function useExamLock() {
  const context = useContext(ExamLockContext);
  if (!context) {
    return { isExamLocked: false, setExamLocked: () => {} };
  }
  return context;
}

export default ExamLockContext;

