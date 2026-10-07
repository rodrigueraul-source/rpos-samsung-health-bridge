plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.parcelize")
}

android {
    namespace = "com.rpos.bridge"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    buildFeatures { buildConfig = true }

    defaultConfig {
        applicationId = "com.rpos.bridge"
        minSdk = 29
        targetSdk = 36
        versionCode = 6
        versionName = "0.6.0"
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
        // Coexists with older installs when their private signing key is unavailable.
        create("delivery") {
            dimension = "healthSource"
            applicationIdSuffix = ".delivery"
            versionNameSuffix = "-delivery"
            resValue("string", "app_name", "R-POS Bridge Envío")
        }
    }

    // Both real flavors use the same read-only Samsung provider.
    sourceSets.getByName("delivery").java.srcDir("src/samsung/java")
    defaultConfig.resValue("string", "app_name", "R-POS Samsung Health Bridge")

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
    "deliveryImplementation"(files("libs/samsung-health-data-api-1.1.0.aar"))
    testImplementation("junit:junit:4.13.2")
}
