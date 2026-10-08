// Standalone build for the metrics viewer. Wraps the npm scripts in package.json and exposes the
// built site (dist/) as the "metricsViewerElements" variant, so a parent build can consume it via
// includeBuild("metrics-viewer") + a dependency on "dev.irisshaders:aperture-metrics-viewer".

plugins {
    base
}

group = "dev.irisshaders"
version = "0.1.0"

val npm = if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) "npm.cmd" else "npm"

val npmInstall = tasks.register<Exec>("npmInstall") {
    group = "npm"
    description = "Installs npm dependencies from package-lock.json."

    commandLine(npm, "ci")

    inputs.files("package.json", "package-lock.json")
    outputs.file("node_modules/.package-lock.json")
}

val npmBuild = tasks.register<Exec>("npmBuild") {
    group = "build"
    description = "Builds the metrics viewer into dist/."

    dependsOn(npmInstall)
    commandLine(npm, "run", "build")

    inputs.dir("src")
    inputs.files("index.html", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts")
    outputs.dir("dist")
}

configurations.consumable("metricsViewerElements") {
    attributes {
        attribute(Usage.USAGE_ATTRIBUTE, objects.named("aperture-metrics-viewer"))
    }
    outgoing.artifact(layout.projectDirectory.dir("dist")) {
        type = ArtifactTypeDefinition.DIRECTORY_TYPE
        builtBy(npmBuild)
    }
}

tasks.assemble {
    dependsOn(npmBuild)
}

tasks.clean {
    delete("dist")
}
