#pragma once
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <iterator>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
 
using namespace std;

struct Json {
    enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
    bool b = false;
    double num = 0;
    string str;
    vector<Json> arr;
    map<string, Json> obj;

    // Returns true when this value is an object that contains the given key.
    bool has(const string& key) const {
        return type == Obj && obj.count(key) > 0;
    }

    // Returns the value stored under the key, or throws when the key is missing.
    const Json& at(const string& key) const {
        auto it = obj.find(key);
        if (type != Obj || it == obj.end()) {
            throw runtime_error("missing field '" + key + "'");
        }
        return it->second;
    }

    // Returns true when this value is a whole number of reasonable size.
    bool isInt() const {
        return type == Num && floor(num) == num && fabs(num) < 1e9;
    }
};

class JsonParser {
    const string& text;
    size_t pos = 0;

    // Skips spaces, tabs and new lines at the current position.
    void skipWhitespace() {
        while (pos < text.size() && isspace((unsigned char)text[pos])) {
            pos++;
        }
    }

    // Stops parsing by throwing an error with the given message.
    [[noreturn]] void error(const string& message) {
        throw runtime_error("invalid JSON: " + message);
    }

    // Reads a quoted string, starting at its opening quote.
    string parseString() {
        string result;
        pos++;
        while (pos < text.size() && text[pos] != '"') {
            if (text[pos] == '\\' && pos + 1 < text.size()) {
                pos++;
                char c = text[pos];
                result += (c == 'n') ? '\n' : (c == 't') ? '\t' : c;
            } else {
                result += text[pos];
            }
            pos++;
        }
        if (pos >= text.size()) {
            error("unterminated string");
        }
        pos++;
        return result;
    }

    // Reads a number such as 12, -3 or 4.5.
    Json parseNumber() {
        Json value;
        char* end = nullptr;
        value.num = strtod(text.c_str() + pos, &end);
        if (end == text.c_str() + pos) {
            error("unexpected character");
        }
        value.type = Json::Num;
        pos = end - text.c_str();
        return value;
    }

    // Reads an object such as {"a": 1, "b": 2}.
    Json parseObject(int depth) {
        Json value;
        value.type = Json::Obj;
        pos++;
        skipWhitespace();
        if (pos < text.size() && text[pos] == '}') {
            pos++;
            return value;
        }
        while (true) {
            skipWhitespace();
            if (pos >= text.size() || text[pos] != '"') {
                error("expected key");
            }
            string key = parseString();
            skipWhitespace();
            if (pos >= text.size() || text[pos] != ':') {
                error("expected ':'");
            }
            pos++;
            value.obj[key] = parseValue(depth + 1);
            skipWhitespace();
            if (pos < text.size() && text[pos] == ',') {
                pos++;
            } else if (pos < text.size() && text[pos] == '}') {
                pos++;
                return value;
            } else {
                error("expected ',' or '}'");
            }
        }
    }

    // Reads an array such as [1, 2, 3].
    Json parseArray(int depth) {
        Json value;
        value.type = Json::Arr;
        pos++;
        skipWhitespace();
        if (pos < text.size() && text[pos] == ']') {
            pos++;
            return value;
        }
        while (true) {
            value.arr.push_back(parseValue(depth + 1));
            skipWhitespace();
            if (pos < text.size() && text[pos] == ',') {
                pos++;
            } else if (pos < text.size() && text[pos] == ']') {
                pos++;
                return value;
            } else {
                error("expected ',' or ']'");
            }
        }
    }

    // Reads any JSON value (object, array, string, number, true, false or null).
    Json parseValue(int depth) {
        if (depth > 32) {
            error("nesting too deep");
        }
        skipWhitespace();
        if (pos >= text.size()) {
            error("unexpected end");
        }
        char c = text[pos];
        if (c == '{') {
            return parseObject(depth);
        }
        if (c == '[') {
            return parseArray(depth);
        }
        Json value;
        if (c == '"') {
            value.type = Json::Str;
            value.str = parseString();
        } else if (text.compare(pos, 4, "true") == 0) {
            value.type = Json::Bool;
            value.b = true;
            pos += 4;
        } else if (text.compare(pos, 5, "false") == 0) {
            value.type = Json::Bool;
            pos += 5;
        } else if (text.compare(pos, 4, "null") == 0) {
            pos += 4;
        } else {
            value = parseNumber();
        }
        return value;
    }

public:
    // Remembers the text that will be parsed.
    explicit JsonParser(const string& input) : text(input) {}

    // Parses the whole text as one JSON value and rejects anything after it.
    Json parseDocument() {
        Json value = parseValue(0);
        skipWhitespace();
        if (pos != text.size()) {
            error("trailing characters");
        }
        return value;
    }
};

// Reads all of standard input and parses it as one JSON document.
inline Json readInput() {
    string text((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());
    return JsonParser(text).parseDocument();
}

// Returns the text as a quoted JSON string with special characters escaped.
inline string q(const string& value) {
    string result = "\"";
    for (char c : value) {
        if (c == '"' || c == '\\') {
            result += '\\';
            result += c;
        } else if (c == '\n') {
            result += "\\n";
        } else if ((unsigned char)c < 0x20) {
            result += ' ';
        } else {
            result += c;
        }
    }
    return result + "\"";
}

// Formats a number: whole numbers without decimals, others with two decimals.
inline string num(double value) {
    ostringstream out;
    out.setf(ios::fixed);
    out.precision(floor(value) == value ? 0 : 2);
    out << value;
    return out.str();
}

// Converts a vector of integers into a JSON array.
template <class T>
string intArr(const vector<T>& values) {
    string result = "[";
    for (size_t i = 0; i < values.size(); i++) {
        result += (i ? "," : "") + to_string(values[i]);
    }
    return result + "]";
}

// Converts a vector of strings into a JSON array.
inline string strArr(const vector<string>& values) {
    string result = "[";
    for (size_t i = 0; i < values.size(); i++) {
        result += (i ? "," : "") + q(values[i]);
    }
    return result + "]";
}

// Converts a matrix of integers into a JSON array of arrays.
inline string matrix(const vector<vector<long long>>& rows) {
    string result = "[";
    for (size_t i = 0; i < rows.size(); i++) {
        result += (i ? "," : "") + intArr(rows[i]);
    }
    return result + "]";
}

// Prints an error as JSON and returns exit code 2.
inline int fail(const string& message) {
    cout << "{\"error\":" << q(message) << "}" << endl;
    return 2;
}