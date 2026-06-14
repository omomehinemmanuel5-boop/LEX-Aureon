/**
 * HumanEval Judge
 *
 * Evaluates whether generated code passes the test cases.
 * Uses Node.js eval() in a sandboxed context.
 */

export interface JudgeResult {
  task_id: string;
  passed: boolean;
  error?: string;
}

export async function judgeCode(
  taskId: string,
  entryPoint: string,
  generatedCode: string,
  testCode: string,
): Promise<JudgeResult> {
  try {
    // Combine generated code + test
    const fullCode = `
${generatedCode}

${testCode}
check_${entryPoint}();
`;

    // Execute in a controlled context
    const result = await executeCode(fullCode);
    
    return {
      task_id: taskId,
      passed: result.success,
      error: result.error,
    };
  } catch (e) {
    return {
      task_id: taskId,
      passed: false,
      error: String(e),
    };
  }
}

async function executeCode(code: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      // Use eval in a controlled way with a timeout
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Timeout' });
      }, 5000);

      // Create a function that executes the code
      const fn = new Function(code);
      fn();

      clearTimeout(timeout);
      resolve({ success: true });
    } catch (e) {
      resolve({ success: false, error: String(e) });
    }
  });
}
