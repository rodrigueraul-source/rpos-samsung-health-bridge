plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.parcelize")
}

android {
    namespace = "com.rpos.bridge"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rpos.bridge"
        minSdk = 29
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0"
    }

    flavorDimensions += "healthSource"
    productFlavors {
        create("mock") {
            dimension = "healthSource"
            applicationIdSuffix = ".mock"
            versionNameSuffix = "-mock"
        }
        create("samsung") {
            dimension = "healthSource"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.google.code.gson:gson:2.13.2")
    "samsungImplementation"(files("libs/samsung-health-data-api-1.1.0.aar"))
    testImplementation("junit:junit:4.13.2")
}
