import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import ts from "typescript"

type Rule =
  | "package-exports"
  | "package-tsconfig"
  | "forbidden-import"
  | "cross-plugin-value-import"
  | "as-unknown"
  | "direct-reactive-hook"
  | "business-context"
  | "display-scoped-context"
  | "feature-exports"

type Diagnostic = { file: string; line: number; rule: Rule; message: string }
type Report = (rule: Rule, message: string, node?: ts.Node) => void
type PackageInfo = {
  group: string
  directory: string
  folder: string
  name: string | undefined
  plugin: boolean
}

const groups = ["core", "runtime", "edu", "client", "plugins", "bundle"]
const renderer = "packages/runtime/slots/src/renderer.tsx"
const businessFeatures: Record<string, true> = {
  schedule: true, "school-schedule": true, grades: true, exams: true, "makeup-exams": true,
  "student-info": true, "training-plan": true, evaluation: true, ecard: true, epay: true,
  meter: true, labor: true, credits: true, comprehensive: true,
}
const ignoredDirectories: Record<string, true> = {
  node_modules: true, dist: true, coverage: true, test: true, tests: true, "__tests__": true,
  "__mocks__": true, "__fixtures__": true,
}

function sourceFiles(directory: string, files: string[]) {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !ignoredDirectories[entry.name]) sourceFiles(file, files)
    } else if (
      entry.isFile() &&
      /\.(?:ts|tsx|mts|cts)$/.test(entry.name) &&
      !/(?:\.test|\.spec|\.d)\.[^.]+$/.test(entry.name)
    ) {
      files.push(file)
    }
  }
}

function verifyPackage(directory: string, manifestFile: string, text: string, report: Report) {
  if (!statSync(path.join(directory, "tsconfig.json"), { throwIfNoEntry: false })?.isFile()) {
    report("package-tsconfig", "Add a tsconfig.json to this package.")
  }

  let metadata: { name?: unknown; exports?: unknown }
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      report("package-exports", "package.json must contain a JSON object.")
      return
    }
    metadata = value
  } catch (error) {
    report("package-exports", `Cannot parse package.json: ${String(error)}`)
    return
  }

  const json = ts.parseJsonText(manifestFile, text)
  const statement = json.statements[0]
  const field = statement && ts.isExpressionStatement(statement) &&
    ts.isObjectLiteralExpression(statement.expression)
    ? statement.expression.properties.find(
        (entry): entry is ts.PropertyAssignment =>
          ts.isPropertyAssignment(entry) && ts.isStringLiteral(entry.name) && entry.name.text === "exports"
      )
    : undefined
  const map = field?.initializer
  if (!map || !ts.isObjectLiteralExpression(map)) {
    report("package-exports", "Declare an explicit exports map with a `.` entry.", field)
  } else {
    const entries = map.properties.filter(ts.isPropertyAssignment)
    if (!entries.some(({ name, initializer }) =>
      ts.isStringLiteral(name) && name.text === "." && initializer.kind !== ts.SyntaxKind.NullKeyword
    )) {
      report("package-exports", "Expose the public entry point explicitly as `exports[\".\"]`.", map)
    }
    for (const { name } of entries) {
      if (!ts.isStringLiteral(name) || name.text === ".") continue
      const key = name.text
      if (
        !key.startsWith("./") || key.endsWith("/") || key.includes("*") ||
        /^\.\/(?:src|dist)(?:\/|$)/.test(key)
      ) {
        report("package-exports", `Replace ${JSON.stringify(key)} with an explicit public subpath.`, name)
      }
    }
  }
  return typeof metadata.name === "string" ? metadata.name : undefined
}

type ModuleReference = { literal: ts.StringLiteralLike; typeOnly: boolean }

function moduleReference(node: ts.Node, checker: ts.TypeChecker): ModuleReference | undefined {
  let moduleNode: ts.Node | undefined
  let typeOnly = false
  if (ts.isImportDeclaration(node)) {
    moduleNode = node.moduleSpecifier
    const clause = node.importClause
    const named = clause?.namedBindings
    typeOnly = clause?.isTypeOnly === true || (
      !clause?.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 &&
      named.elements.every((element) => element.isTypeOnly)
    )
  } else if (ts.isExportDeclaration(node)) {
    moduleNode = node.moduleSpecifier
    const named = node.exportClause
    typeOnly = node.isTypeOnly || (
      !!named && ts.isNamedExports(named) && named.elements.length > 0 &&
      named.elements.every((element) => element.isTypeOnly)
    )
  } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    moduleNode = node.moduleReference.expression
    typeOnly = node.isTypeOnly
  } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    moduleNode = node.argument.literal
    typeOnly = true
  } else if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (callee.kind === ts.SyntaxKind.ImportKeyword || (
      ts.isIdentifier(callee) && callee.text === "require" && !checker.getSymbolAtLocation(callee)
    )) {
      moduleNode = node.arguments[0]
    }
  }
  if (moduleNode && ts.isStringLiteralLike(moduleNode)) return { literal: moduleNode, typeOnly }
}

function containingPackage(file: string, packages: PackageInfo[]) {
  return packages.find(({ directory }) => file === directory || file.startsWith(directory + path.sep))
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) ||
    ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    expression = expression.expression
  }
  return expression
}

type ImportedBinding = { module: string; name: string }

// Resolve lexical bindings without loading packages or applying tsconfig aliases.
function importedBinding(node: ts.Node, checker: ts.TypeChecker): ImportedBinding | undefined {
  let identifier: ts.Identifier
  let member: string | undefined
  if (ts.isIdentifier(node)) {
    identifier = node
  } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const receiver = unwrap(node.expression)
    if (!ts.isIdentifier(receiver)) return
    identifier = receiver
    if (ts.isPropertyAccessExpression(node)) member = node.name.text
    else if (ts.isStringLiteralLike(node.argumentExpression)) member = node.argumentExpression.text
    else return
  } else if (ts.isQualifiedName(node) && ts.isIdentifier(node.left)) {
    identifier = node.left
    member = node.right.text
  } else {
    return
  }

  const declaration = checker.getSymbolAtLocation(identifier)?.declarations?.[0]
  if (!declaration) return
  let importDeclaration: ts.ImportDeclaration
  let name: string
  if (ts.isImportSpecifier(declaration) && member === undefined) {
    const candidate: ts.Node = declaration.parent.parent.parent
    if (!ts.isImportDeclaration(candidate)) return
    importDeclaration = candidate
    name = (declaration.propertyName ?? declaration.name).text
  } else if (ts.isNamespaceImport(declaration) && member !== undefined) {
    const candidate: ts.Node = declaration.parent.parent
    if (!ts.isImportDeclaration(candidate)) return
    importDeclaration = candidate
    name = member
  } else if (ts.isImportClause(declaration) && ts.isImportDeclaration(declaration.parent)) {
    importDeclaration = declaration.parent
    name = member ?? "default"
  } else {
    return
  }
  if (ts.isStringLiteral(importDeclaration.moduleSpecifier)) {
    return { module: importDeclaration.moduleSpecifier.text, name }
  }
}

function isPluginContext(binding: ImportedBinding | undefined) {
  return (binding?.name === "Context" && (binding.module === "@orahako/sdk" || binding.module === "@cordisjs/core")) ||
    (binding?.name === "ScopedPluginContext" && binding.module === "@orahako/sdk")
}

function isScopedContext(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  expression = unwrap(expression)
  if (ts.isNewExpression(expression)) return isPluginContext(importedBinding(expression.expression, checker))
  if (!ts.isIdentifier(expression)) return false
  const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration
  if (!declaration || (!ts.isParameter(declaration) && !ts.isVariableDeclaration(declaration))) {
    return false
  }
  const type = declaration.type
  if (type && ts.isTypeReferenceNode(type) && isPluginContext(importedBinding(type.typeName, checker))) {
    return true
  }
  if (declaration.initializer && ts.isNewExpression(declaration.initializer)) {
    return isPluginContext(importedBinding(declaration.initializer.expression, checker))
  }
  // The first parameter of a definePlugin({ apply }) method is a scoped context.
  if (ts.isParameter(declaration) && ts.isMethodDeclaration(declaration.parent)) {
    const method = declaration.parent
    const spec = method.parent
    if (method.parameters[0] === declaration && ts.isIdentifier(method.name) && method.name.text === "apply" &&
      ts.isObjectLiteralExpression(spec) && ts.isCallExpression(spec.parent) && spec.parent.arguments[0] === spec) {
      const binding = importedBinding(unwrap(spec.parent.expression), checker)
      return binding?.module === "@orahako/sdk" && binding.name === "definePlugin"
    }
  }
  return false
}

function isKnownReactContext(expression: ts.Expression, checker: ts.TypeChecker) {
  expression = unwrap(expression)
  if (!ts.isIdentifier(expression)) return false
  const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration
  if (!declaration || (!ts.isParameter(declaration) && !ts.isVariableDeclaration(declaration))) {
    return false
  }
  const type = declaration.type
  if (type && ts.isTypeReferenceNode(type)) {
    const binding = importedBinding(type.typeName, checker)
    if (binding?.module === "react" && binding.name === "Context") return true
  }
  const init = declaration.initializer && unwrap(declaration.initializer)
  if (init && ts.isCallExpression(init)) {
    const binding = importedBinding(unwrap(init.expression), checker)
    return binding?.module === "react" && binding.name === "createContext"
  }
  return false
}

function verifyFeatureExports(source: ts.SourceFile, folder: string, report: Report) {
  const id = `${folder.replaceAll("-", "_").toUpperCase()}_PLUGIN_ID`
  const definition = `${folder.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())}Plugin`
  const message = `Keep the feature entry limited to ${id}, ${definition}, its default export, and types; import implementation details locally.`
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      if (statement.isTypeOnly) continue
      if (!clause || !ts.isNamedExports(clause)) {
        report("feature-exports", message, statement)
      } else {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue
          const name = element.name.text
          if (statement.moduleSpecifier || (name !== id && name !== definition &&
            !(name === "default" && element.propertyName?.text === definition))) {
            report("feature-exports", message, element)
          }
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      const value = unwrap(statement.expression)
      if (statement.isExportEquals || !ts.isIdentifier(value) || value.text !== definition) {
        report("feature-exports", message, statement)
      }
    } else if (ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      !ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) {
      if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
        for (const { name } of statement.declarationList.declarations) {
          if (!ts.isIdentifier(name) || (name.text !== id && name.text !== definition)) {
            report("feature-exports", message, name)
          }
        }
      } else {
        report("feature-exports", message, statement)
      }
    }
  }
}

function verifySource(
  source: ts.SourceFile,
  file: string,
  pkg: PackageInfo,
  packages: PackageInfo[],
  checker: ts.TypeChecker,
  report: Report
) {
  const isRenderer = file === renderer
  const displayTsx = file.endsWith(".tsx") && !isRenderer
  // UI primitives may use presentational context (e.g. sidebar state), not Cordis ctx.
  const businessTsx = displayTsx && !(pkg.group === "core" && pkg.folder === "ui-primitives")

  if (pkg.group === "plugins" && businessFeatures[pkg.folder] &&
    /^src[\/]index\.tsx?$/.test(path.relative(pkg.directory, source.fileName))) {
    verifyFeatureExports(source, pkg.folder, report)
  }

  function visit(node: ts.Node) {
    const reference = moduleReference(node, checker)
    if (reference) {
      const { literal, typeOnly } = reference
      const specifier = literal.text
      if (specifier.startsWith("@/") || specifier === "next" || specifier.startsWith("next/")) {
        report("forbidden-import", `Replace ${JSON.stringify(specifier)} with a v3 package or local relative import.`, literal)
      } else if (pkg.plugin && !typeOnly) {
        const target = /^\.{1,2}(?:\/|$)/.test(specifier)
          ? containingPackage(path.resolve(path.dirname(source.fileName), specifier), packages)
          : packages.find(({ name }) => name && (name === specifier || specifier.startsWith(name + "/")))
        if (target?.plugin && target !== pkg) {
          report("cross-plugin-value-import", `Do not load ${JSON.stringify(specifier)} at runtime. Use type-only imports for contracts and inject services for values.`, literal)
        }
      }
    }

    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      let type = node.type
      while (ts.isParenthesizedTypeNode(type)) type = type.type
      if (type.kind === ts.SyntaxKind.UnknownKeyword) {
        report("as-unknown", "Avoid casts to unknown; narrow the value or fix the source type.", type)
      }
    }

    if (!isRenderer && ts.isCallExpression(node)) {
      const binding = importedBinding(unwrap(node.expression), checker)
      const expression = unwrap(node.expression)
      const directName = ts.isIdentifier(expression) ? expression.text :
        ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined
      const hook = (binding && (
        (binding.module === "react" || binding.module.startsWith("use-sync-external-store/")) &&
          binding.name === "useSyncExternalStore" ? "useSyncExternalStore" :
        (binding.module === "swr" || binding.module === "swr/immutable") &&
          (binding.name === "default" || binding.name === "useSWR") ? "useSWR" : undefined
      )) ?? (directName === "useSyncExternalStore" ? "useSyncExternalStore" :
        directName === "useSWR" ? "useSWR" : undefined)
      if (hook) {
        report("direct-reactive-hook", `Use derived hooks instead of ${hook}; only ${renderer} may call it directly.`, node)
      }
      if (businessTsx && binding?.module === "react" && (
        binding.name === "useContext" || (binding.name === "use" && node.arguments[0] &&
          isKnownReactContext(node.arguments[0], checker))
      )) {
        report("business-context", "Pass business state through derived props instead of consuming React context.", node)
      } else if (businessTsx && (directName === "useContext" || directName === "use")) {
        report("business-context", "Pass business state through derived props instead of consuming React context.", node)
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (displayTsx && isScopedContext(node.expression, checker)) {
        report("display-scoped-context", "Bind scoped plugin services in registration code and pass derived props to display TSX.", node)
      }
      const member = ts.isPropertyAccessExpression(node) ? node.name.text :
        ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined
      if (businessTsx && member === "Consumer" && isKnownReactContext(node.expression, checker)) {
        report("business-context", "Pass business state through derived props instead of consuming React context.", node)
      }
    }
    if (displayTsx && ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name) &&
      node.initializer && isScopedContext(node.initializer, checker)) {
      report("display-scoped-context", "Bind scoped plugin services in registration code and pass derived props to display TSX.", node.name)
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
}

export function verifyArchitecture(root: string) {
  root = path.resolve(root)
  const diagnostics: Diagnostic[] = []
  const packages: PackageInfo[] = []
  const files: string[] = []
  function reporter(file: string): Report {
    return (rule, message, node) => {
      const line = node ? node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1 : 1
      diagnostics.push({ file, line, rule, message })
    }
  }

  for (const group of groups) {
    const base = path.join(root, "packages", group)
    if (!statSync(base, { throwIfNoEntry: false })?.isDirectory()) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = path.join(base, entry.name)
      const manifest = path.join(directory, "package.json")
      if (!statSync(manifest, { throwIfNoEntry: false })?.isFile()) continue
      const name = verifyPackage(directory, manifest, readFileSync(manifest, "utf8"), reporter(path.relative(root, manifest)))
      const plugin = group === "plugins" || group === "client" || group === "runtime" ||
        (group === "edu" && entry.name === "runtime")
      packages.push({ group, directory, folder: entry.name, name, plugin })
      sourceFiles(path.join(directory, "src"), files)
    }
  }

  const program = ts.createProgram(files, { noResolve: true, noLib: true, types: [] })
  const checker = program.getTypeChecker()
  for (const source of program.getSourceFiles()) {
    const pkg = containingPackage(source.fileName, packages)
    if (!pkg) continue
    const relative = path.relative(root, source.fileName)
    verifySource(source, relative.split(path.sep).join("/"), pkg, packages, checker, reporter(relative))
  }

  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule))
  return { diagnostics, packageCount: packages.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const { diagnostics, packageCount } = verifyArchitecture(root)
  for (const { file, line, rule, message } of diagnostics) {
    console.error(`${file}:${line}: [${rule}] ${message}`)
  }
  if (diagnostics.length) {
    console.error(`Architecture verification failed with ${diagnostics.length} violation(s).`)
    process.exitCode = 1
  } else {
    console.log(`Architecture verification passed (${packageCount} API v1 packages scanned).`)
  }
}
