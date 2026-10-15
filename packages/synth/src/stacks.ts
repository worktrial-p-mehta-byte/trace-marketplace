/**
 * The demo catalog's world: language/framework stacks with how common they
 * are, failure patterns, models and the nouns titles are built from. Weights
 * make everyday stacks common and niche ones rare, so rarity pricing has
 * something to work with.
 */
export interface Stack {
  language: string;
  framework?: string;
  ext: string;
  testCmd: string;
  /** Text that makes the framework detectable (imports, commands). */
  mentions: string[];
  weight: number;
  nouns: string[];
}

export const STACKS: Stack[] = [
  { language: "TypeScript", framework: "React", ext: "tsx", testCmd: "npm test", mentions: ["import React from 'react'", "react-dom"], weight: 18, nouns: ["signup form", "settings page", "data table", "date picker", "modal"] },
  { language: "TypeScript", framework: "Next.js", ext: "ts", testCmd: "npm test", mentions: ["next build", "import Link from 'next/link'"], weight: 10, nouns: ["checkout page", "API route", "middleware", "image loader"] },
  { language: "TypeScript", framework: "Express", ext: "ts", testCmd: "npm test", mentions: ["import express from 'express'", "express.Router()"], weight: 6, nouns: ["rate limiter", "auth middleware", "webhook handler"] },
  { language: "Python", framework: "Django", ext: "py", testCmd: "pytest", mentions: ["from django.db import models", "django migrations"], weight: 8, nouns: ["migration", "admin view", "ORM query", "signup flow"] },
  { language: "Python", framework: "FastAPI", ext: "py", testCmd: "pytest", mentions: ["from fastapi import FastAPI", "fastapi.Depends"], weight: 8, nouns: ["auth dependency", "background task", "upload endpoint"] },
  { language: "Python", framework: "pandas", ext: "py", testCmd: "pytest", mentions: ["import pandas as pd", "pandas DataFrame"], weight: 5, nouns: ["CSV importer", "billing export", "report job"] },
  { language: "Python", framework: "PyTorch", ext: "py", testCmd: "pytest", mentions: ["import torch", "torch.nn"], weight: 4, nouns: ["training loop", "data loader", "checkpoint loader"] },
  { language: "Go", framework: "Gin", ext: "go", testCmd: "go test ./...", mentions: ["gin.Default()", "github.com/gin-gonic/gin"], weight: 4, nouns: ["cache layer", "HTTP handler", "worker pool"] },
  { language: "Java", framework: "Spring", ext: "java", testCmd: "mvn test", mentions: ["@SpringBootApplication", "spring-boot"], weight: 4, nouns: ["REST controller", "JPA repository", "scheduler"] },
  { language: "Ruby", framework: "Rails", ext: "rb", testCmd: "bundle exec rspec", mentions: ["rails generate", "class ApplicationRecord < ActiveRecord::Base # rails"], weight: 3, nouns: ["mailer", "background job", "model validation"] },
  { language: "Rust", framework: "Tokio", ext: "rs", testCmd: "cargo test", mentions: ["use tokio::sync::Mutex", "#[tokio::main]"], weight: 2, nouns: ["job queue", "connection pool", "async worker"] },
  { language: "Rust", framework: "Axum", ext: "rs", testCmd: "cargo test", mentions: ["use axum::Router", "axum::extract"], weight: 1, nouns: ["router", "extractor", "middleware layer"] },
  { language: "Kotlin", framework: "Spring", ext: "kt", testCmd: "gradle test", mentions: ["@SpringBootApplication", "spring-boot kotlin"], weight: 1, nouns: ["coroutine scope", "REST client"] },
  { language: "Elixir", ext: "ex", testCmd: "mix test", mentions: ["defmodule", "GenServer"], weight: 1, nouns: ["GenServer", "supervisor tree"] },
  { language: "Terraform", ext: "tf", testCmd: "terraform plan", mentions: ["resource \"aws_iam_role\"", "terraform plan"], weight: 2, nouns: ["IAM policy", "VPC module", "S3 bucket policy"] },
  { language: "C++", ext: "cpp", testCmd: "make test", mentions: ["#include <vector>", "cmake"], weight: 1, nouns: ["memory pool", "parser", "SIMD kernel"] },
  { language: "Haskell", ext: "hs", testCmd: "stack test", mentions: ["import Data.Map", "cabal"], weight: 0.5, nouns: ["type class", "parser combinator"] },
  { language: "Solidity", ext: "sol", testCmd: "forge test", mentions: ["pragma solidity", "forge"], weight: 0.5, nouns: ["token contract", "reentrancy guard"] },
  { language: "COBOL", ext: "cbl", testCmd: "cobc -x main.cbl && ./main", mentions: ["IDENTIFICATION DIVISION", "PROCEDURE DIVISION"], weight: 0.3, nouns: ["batch payroll job", "record layout"] },
  { language: "Verilog", ext: "v", testCmd: "iverilog -o sim tb.v && vvp sim", mentions: ["module counter", "always @(posedge clk)"], weight: 0.3, nouns: ["FIFO", "UART receiver"] },
];

export type Pattern =
  | "clean"
  | "tool_error"
  | "retry_loop"
  | "user_correction"
  | "tool_rejected"
  | "user_interrupt"
  | "test_tampering";

export const PATTERNS: { pattern: Pattern; weight: number }[] = [
  { pattern: "clean", weight: 25 },
  { pattern: "tool_error", weight: 25 },
  { pattern: "user_correction", weight: 15 },
  { pattern: "retry_loop", weight: 12 },
  { pattern: "tool_rejected", weight: 8 },
  { pattern: "user_interrupt", weight: 6 },
  { pattern: "test_tampering", weight: 5 },
];

export const MODELS: { id: string; weight: number }[] = [
  { id: "claude-sonnet-4-5", weight: 45 },
  { id: "claude-opus-5-5", weight: 25 },
  { id: "claude-sonnet-5-5", weight: 15 },
  { id: "claude-haiku-4-5", weight: 15 },
];

export const PATTERN_TITLES: Record<Pattern, string[]> = {
  clean: ["Add {noun} tests", "Refactor the {noun}", "Document the {noun}", "Small fix in the {noun}"],
  tool_error: ["{noun} build breaks", "Fix failing {noun} tests", "{noun} throws on empty input"],
  retry_loop: ["{noun} keeps failing in CI", "Agent stuck rerunning the {noun} tests", "{noun} flaky under load"],
  user_correction: ["{noun} rewritten the wrong way", "Agent misread the {noun} spec", "{noun} change reverted by the user"],
  tool_rejected: ["Risky {noun} change rejected", "Agent tried to drop the {noun} table", "{noun} force-push blocked"],
  user_interrupt: ["Agent went off track on the {noun}", "{noun} edit stopped midway"],
  test_tampering: ["{noun} test deleted instead of fixed", "Agent weakened the {noun} assertions"],
};
