export type JevNoulQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevQuestion = JevNoulQuestion | JevScoreQuestion | JevChoiceQuestion;
export type JevQuestions = Record<string, JevQuestion>;
