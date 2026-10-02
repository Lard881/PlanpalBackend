# Flutter i18n Integration Guide

## Overview
This document provides comprehensive guidance for implementing internationalization (i18n) and localization (l10n) in the PlanPal Flutter app, integrating with the backend user preferences system.

---

## Dependencies

Add to `pubspec.yaml`:
```yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter
  intl: ^0.18.0
  intl_utils: ^2.8.0

dev_dependencies:
  flutter_gen: ^5.3.0
```

---

## Project Structure

```
app/
├── lib/
│   ├── l10n/
│   │   ├── app_en.arb          # English translations (master)
│   │   ├── app_es.arb          # Spanish translations
│   │   ├── app_fr.arb          # French translations
│   │   └── ...                  # Other language files
│   ├── core/
│   │   ├── localization/
│   │   │   ├── app_localizations.dart
│   │   │   ├── app_localizations_delegate.dart
│   │   │   └── supported_locales.dart
│   │   └── preferences/
│   │       ├── user_preferences.dart
│   │       └── preferences_provider.dart
│   └── main.dart
└── l10n.yaml                    # Configuration file
```

---

## Configuration

### 1. Create l10n.yaml

```yaml
arb-dir: lib/l10n
template-arb-file: app_en.arb
output-localization-file: app_localizations.dart
output-class: AppLocalizations
nullable-getter: false
synthetic-package: false
output-dir: lib/core/localization
```

### 2. Update pubspec.yaml

```yaml
flutter:
  generate: true
  uses-material-design: true
  
flutter_intl:
  enabled: true
  class_name: S
  main_locale: en
  arb_dir: lib/l10n
  output_dir: lib/core/localization
```

---

## ARB File Structure

### app_en.arb (Master/Template)

```json
{
  "@@locale": "en",
  "appName": "PlanPal",
  "@appName": {
    "description": "The application name"
  },
  
  "welcomeMessage": "Welcome to PlanPal!",
  "@welcomeMessage": {
    "description": "Welcome message shown on first launch"
  },
  
  "taskTitle": "Task",
  "tasks": "Tasks",
  "tasksCount": "{count, plural, =0{No tasks} =1{1 task} other{{count} tasks}}",
  "@tasksCount": {
    "description": "Number of tasks with pluralization",
    "placeholders": {
      "count": {
        "type": "int",
        "example": "5"
      }
    }
  },
  
  "taskDueIn": "Due in {days} {days, plural, =1{day} other{days}}",
  "@taskDueIn": {
    "placeholders": {
      "days": {
        "type": "int"
      }
    }
  },
  
  "greetingMessage": "Hello, {userName}!",
  "@greetingMessage": {
    "placeholders": {
      "userName": {
        "type": "String",
        "example": "John"
      }
    }
  },
  
  "taskCreatedAt": "Created on {date}",
  "@taskCreatedAt": {
    "placeholders": {
      "date": {
        "type": "DateTime",
        "format": "yMd"
      }
    }
  },
  
  "currency": "{amount, currency}",
  "@currency": {
    "placeholders": {
      "amount": {
        "type": "double",
        "format": "currency"
      }
    }
  },
  
  "errorGeneric": "Something went wrong. Please try again.",
  "errorNetwork": "Network error. Check your connection.",
  "errorUnauthorized": "Please sign in to continue.",
  
  "buttonSave": "Save",
  "buttonCancel": "Cancel",
  "buttonDelete": "Delete",
  "buttonEdit": "Edit",
  "buttonAdd": "Add",
  
  "validationRequired": "This field is required",
  "validationEmail": "Please enter a valid email",
  "validationMinLength": "Must be at least {min} characters",
  "@validationMinLength": {
    "placeholders": {
      "min": {"type": "int"}
    }
  }
}
```

### app_es.arb (Spanish Example)

```json
{
  "@@locale": "es",
  "appName": "PlanPal",
  "welcomeMessage": "¡Bienvenido a PlanPal!",
  "taskTitle": "Tarea",
  "tasks": "Tareas",
  "tasksCount": "{count, plural, =0{Sin tareas} =1{1 tarea} other{{count} tareas}}",
  "taskDueIn": "Vence en {days} {days, plural, =1{día} other{días}}",
  "greetingMessage": "¡Hola, {userName}!",
  "taskCreatedAt": "Creado el {date}",
  "errorGeneric": "Algo salió mal. Por favor, inténtalo de nuevo.",
  "errorNetwork": "Error de red. Verifica tu conexión.",
  "errorUnauthorized": "Por favor inicia sesión para continuar.",
  "buttonSave": "Guardar",
  "buttonCancel": "Cancelar",
  "buttonDelete": "Eliminar",
  "buttonEdit": "Editar",
  "buttonAdd": "Añadir"
}
```

---

## Main App Configuration

### main.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/localization/app_localizations.dart';
import 'core/localization/supported_locales.dart';
import 'core/preferences/preferences_provider.dart';

void main() {
  runApp(
    const ProviderScope(
      child: MyApp(),
    ),
  );
}

class MyApp extends ConsumerWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preferencesAsync = ref.watch(userPreferencesProvider);
    
    return preferencesAsync.when(
      data: (preferences) {
        // Parse language code from preferences
        final locale = _parseLocale(preferences.language);
        
        return MaterialApp(
          title: 'PlanPal',
          
          // Localization delegates
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          
          // Supported locales
          supportedLocales: SupportedLocales.all,
          
          // User's preferred locale
          locale: locale,
          
          // Fallback if user's locale not supported
          localeResolutionCallback: (locale, supportedLocales) {
            if (locale == null) {
              return supportedLocales.first;
            }
            
            // Check if exact match exists
            for (var supportedLocale in supportedLocales) {
              if (supportedLocale.languageCode == locale.languageCode &&
                  supportedLocale.countryCode == locale.countryCode) {
                return supportedLocale;
              }
            }
            
            // Check if language code match exists
            for (var supportedLocale in supportedLocales) {
              if (supportedLocale.languageCode == locale.languageCode) {
                return supportedLocale;
              }
            }
            
            // Return first supported locale as fallback
            return supportedLocales.first;
          },
          
          // Theme based on preferences
          theme: _buildTheme(preferences, Brightness.light),
          darkTheme: _buildTheme(preferences, Brightness.dark),
          themeMode: _parseThemeMode(preferences.theme),
          
          home: const HomeScreen(),
        );
      },
      loading: () => const MaterialApp(
        home: Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      ),
      error: (error, stack) => MaterialApp(
        home: Scaffold(
          body: Center(child: Text('Error loading preferences: $error')),
        ),
      ),
    );
  }
  
  Locale _parseLocale(String languageCode) {
    // Parse language code to Locale
    // Examples: 'en' -> Locale('en'), 'en-US' -> Locale('en', 'US')
    final parts = languageCode.split('-');
    if (parts.length == 2) {
      return Locale(parts[0], parts[1]);
    }
    return Locale(parts[0]);
  }
  
  ThemeMode _parseThemeMode(String theme) {
    switch (theme) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      case 'system':
      default:
        return ThemeMode.system;
    }
  }
  
  ThemeData _buildTheme(UserPreferences prefs, Brightness brightness) {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: prefs.accentColor != null
          ? _parseColor(prefs.accentColor!)
          : Colors.blue,
      brightness: brightness,
    );
    
    return ThemeData(
      colorScheme: colorScheme,
      useMaterial3: true,
    );
  }
  
  Color _parseColor(String hexColor) {
    return Color(int.parse(hexColor.replaceFirst('#', '0xFF')));
  }
}
```

---

## Supported Locales

### supported_locales.dart

```dart
import 'package:flutter/material.dart';

class SupportedLocales {
  static const List<Locale> all = [
    Locale('en', 'US'), // English (US)
    Locale('es', 'ES'), // Spanish (Spain)
    Locale('fr', 'FR'), // French (France)
    Locale('de', 'DE'), // German (Germany)
    Locale('it', 'IT'), // Italian (Italy)
    Locale('pt', 'PT'), // Portuguese (Portugal)
    Locale('ja', 'JP'), // Japanese (Japan)
    Locale('ko', 'KR'), // Korean (Korea)
    Locale('zh', 'CN'), // Chinese (Simplified)
    Locale('ar', 'SA'), // Arabic (Saudi Arabia)
    Locale('hi', 'IN'), // Hindi (India)
    Locale('ru', 'RU'), // Russian (Russia)
    Locale('nl', 'NL'), // Dutch (Netherlands)
    Locale('pl', 'PL'), // Polish (Poland)
    Locale('tr', 'TR'), // Turkish (Turkey)
  ];
  
  static Locale fromLanguageCode(String code) {
    final parts = code.split('-');
    if (parts.length == 2) {
      return Locale(parts[0], parts[1]);
    }
    
    // Find matching locale from supported list
    for (final locale in all) {
      if (locale.languageCode == parts[0]) {
        return locale;
      }
    }
    
    // Default to English
    return all.first;
  }
  
  static String toLanguageCode(Locale locale) {
    if (locale.countryCode != null) {
      return '${locale.languageCode}-${locale.countryCode}';
    }
    return locale.languageCode;
  }
}
```

---

## Using Translations in Code

### Basic Usage

```dart
import 'package:flutter/material.dart';
import 'core/localization/app_localizations.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    
    return Column(
      children: [
        Text(l10n.welcomeMessage),
        Text(l10n.tasksCount(5)), // "5 tasks"
        Text(l10n.greetingMessage('John')), // "Hello, John!"
      ],
    );
  }
}
```

### With Pluralization

```dart
// Show task count with proper pluralization
Text(l10n.tasksCount(taskList.length))

// "No tasks" when 0
// "1 task" when 1
// "5 tasks" when 5
```

### With Date Formatting

```dart
final l10n = AppLocalizations.of(context)!;
final now = DateTime.now();

// Will format according to user's locale
Text(l10n.taskCreatedAt(now))
```

---

## Language Selector Widget

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class LanguageSelector extends ConsumerWidget {
  const LanguageSelector({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context)!;
    final preferencesAsync = ref.watch(userPreferencesProvider);
    
    return preferencesAsync.when(
      data: (preferences) {
        return ListTile(
          title: Text(l10n.language),
          subtitle: Text(_getLanguageName(preferences.language)),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showLanguagePicker(context, ref, preferences.language),
        );
      },
      loading: () => const ListTile(
        title: Text('Language'),
        trailing: CircularProgressIndicator(),
      ),
      error: (_, __) => const ListTile(
        title: Text('Language'),
        subtitle: Text('Error loading'),
      ),
    );
  }
  
  String _getLanguageName(String code) {
    final languageNames = {
      'en': 'English',
      'es': 'Español',
      'fr': 'Français',
      'de': 'Deutsch',
      'it': 'Italiano',
      'pt': 'Português',
      'ja': '日本語',
      'ko': '한국어',
      'zh': '中文',
      'ar': 'العربية',
      'hi': 'हिन्दी',
      'ru': 'Русский',
      'nl': 'Nederlands',
      'pl': 'Polski',
      'tr': 'Türkçe',
    };
    
    return languageNames[code] ?? code;
  }
  
  Future<void> _showLanguagePicker(
    BuildContext context,
    WidgetRef ref,
    String currentLanguage,
  ) async {
    // Fetch available languages from API
    final languages = await ref
        .read(preferencesRepositoryProvider)
        .getSupportedLanguages();
    
    if (!context.mounted) return;
    
    final selected = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppLocalizations.of(context)!.selectLanguage),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: languages.map((lang) {
              return RadioListTile<String>(
                title: Text('${lang.flagEmoji} ${lang.nativeName}'),
                subtitle: Text(lang.name),
                value: lang.code,
                groupValue: currentLanguage,
                onChanged: (value) => Navigator.pop(context, value),
              );
            }).toList(),
          ),
        ),
      ),
    );
    
    if (selected != null && selected != currentLanguage) {
      // Update preference via API
      await ref
          .read(preferencesRepositoryProvider)
          .updatePreferences({'language': selected});
      
      // Refresh preferences
      ref.invalidate(userPreferencesProvider);
    }
  }
}
```

---

## RTL (Right-to-Left) Support

### Detecting RTL Languages

```dart
class RTLHelper {
  static bool isRTL(String languageCode) {
    return ['ar', 'he', 'fa', 'ur'].contains(languageCode);
  }
  
  static TextDirection getTextDirection(String languageCode) {
    return isRTL(languageCode) ? TextDirection.rtl : TextDirection.ltr;
  }
}
```

### Using Directionality Widget

```dart
class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final languageCode = // get from preferences
    
    return Directionality(
      textDirection: RTLHelper.getTextDirection(languageCode),
      child: MaterialApp(
        // ...
      ),
    );
  }
}
```

### RTL-Aware Padding

```dart
// Instead of:
Padding(padding: EdgeInsets.only(left: 16))

// Use:
Padding(padding: EdgeInsetsDirectional.only(start: 16))
```

---

## Date and Time Formatting

```dart
import 'package:intl/intl.dart';

class DateTimeFormatter {
  static String formatDate(DateTime date, String format, String locale) {
    switch (format) {
      case 'MM/DD/YYYY':
        return DateFormat.yMd(locale).format(date);
      case 'DD/MM/YYYY':
        return DateFormat('dd/MM/yyyy', locale).format(date);
      case 'YYYY-MM-DD':
        return DateFormat('yyyy-MM-dd', locale).format(date);
      default:
        return DateFormat.yMd(locale).format(date);
    }
  }
  
  static String formatTime(DateTime time, String format, String locale) {
    if (format == '24h') {
      return DateFormat.Hm(locale).format(time);
    }
    return DateFormat.jm(locale).format(time);
  }
  
  static String formatDateTime(DateTime dt, UserPreferences prefs) {
    final dateStr = formatDate(dt, prefs.dateFormat, prefs.locale);
    final timeStr = formatTime(dt, prefs.timeFormat, prefs.locale);
    return '$dateStr $timeStr';
  }
}
```

---

## Translation Workflow

### 1. Development Phase
- Write all strings in English (app_en.arb)
- Use descriptive keys: `taskCreateSuccess` not `msg1`
- Add descriptions and placeholders

### 2. Translation Phase
- Export app_en.arb to translators
- Translators create app_es.arb, app_fr.arb, etc.
- Review translations for context

### 3. Integration Phase
- Place translated ARB files in lib/l10n/
- Run `flutter gen-l10n` or `flutter pub get`
- Generated code appears in lib/core/localization/

### 4. Testing Phase
- Test each language in app
- Verify RTL languages display correctly
- Check text doesn't overflow in any language
- Test pluralization rules

---

## Best Practices

1. **Never Hardcode Strings:** Always use l10n for user-facing text
2. **Use Descriptive Keys:** `buttonSaveTask` not `btn1`
3. **Group Related Strings:** Prefix with feature (e.g., `task`, `profile`)
4. **Provide Context:** Add descriptions to ARB files
5. **Test All Languages:** Don't assume English layout works for all
6. **Support RTL:** Use EdgeInsetsDirectional, Alignment, etc.
7. **Format Dates Properly:** Respect user's date/time format preferences
8. **Handle Plurals:** Different languages have different plural rules
9. **Length Variations:** Design UI to handle text expansion (German is ~30% longer)
10. **Update Regularly:** Keep translations in sync with features

---

## Testing

```dart
void main() {
  testWidgets('shows localized text', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('es'),
        localizationsDelegates: [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
        ],
        supportedLocales: SupportedLocales.all,
        home: MyWidget(),
      ),
    );
    
    expect(find.text('¡Bienvenido a PlanPal!'), findsOneWidget);
  });
}
```

---

## Integration Checklist

- [ ] Add dependencies to pubspec.yaml
- [ ] Create l10n.yaml configuration
- [ ] Create app_en.arb master file
- [ ] Generate localizations
- [ ] Update main.dart with delegates
- [ ] Create SupportedLocales class
- [ ] Implement language selector
- [ ] Add RTL support
- [ ] Create date/time formatters
- [ ] Replace all hardcoded strings
- [ ] Test all supported languages
- [ ] Verify RTL languages
- [ ] Test pluralization
- [ ] Update documentation

---

## Resources

- [Flutter Internationalization](https://docs.flutter.dev/development/accessibility-and-localization/internationalization)
- [intl Package](https://pub.dev/packages/intl)
- [ARB Format Specification](https://github.com/google/app-resource-bundle)
- [Unicode CLDR Plural Rules](http://cldr.unicode.org/index/cldr-spec/plural-rules)
