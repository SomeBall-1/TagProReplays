var gulp = require('gulp'),
    browserify = require('browserify'),
    watchify = require('watchify'),
    es = require('event-stream'),
    glob = require('glob'),
    gutil = require('gulp-util'),
    rename = require('gulp-rename'),
    source = require('vinyl-source-stream'),
    assign = require('lodash.assign'),
    watch = require('gulp-watch'),
    plumber = require('gulp-plumber');

var assets = [
    // Asset files in src
    ['src/**/*', '!src/js/**/*'],
    // Asset files in vendor
    ['vendor/**/*', '!vendor/js/**/*']
];

var sources = 'src/js/*.js';
var dirs = {
    dev: './build/dev',
    release: './build/release'
};

gulp.task('build-dev', function() {
    var bundle = glob(sources, function (err, files) {
        var streams = files.map(function (entry) {
            return browserify({
                    entries: entry,
                    debug: true
                })
                .bundle()
                .pipe(source(entry.replace(/^\.\/src\//, '')))
                .pipe(gulp.dest(dirs.dev));
        });
        return es.merge(streams);
    });
    
    assets.forEach(function(asset) {
        gulp.src(asset)
            .pipe(gulp.dest(dirs.dev));
    });
    return bundle;
});

// Compile and watchify sourced file.
function watchifyFile(src, out) {
    var opts = assign({}, watchify.args, {
        entries: src,
        debug: true
    });
    var b = watchify(browserify(opts));
    function bundle() {
        return b.bundle()
            .on('error', gutil.log.bind(gutil, "Browserify Error"))
            .pipe(source(src.replace(/^\.\/src\//, '')))
            .pipe(gulp.dest(out));
    }
    b.on('update', bundle);
    b.on('log', gutil.log);
    return bundle();
}

gulp.task('watch-dev', function() {
    var bundle = glob(sources, function (err, files) {
        var streams = files.map(function (entry) {
            return watchifyFile(entry, dirs.dev);
        });
        return es.merge(streams);
    });
    
    assets.forEach(function(asset) {
        gulp.src(asset)
            .pipe(watch(asset))
            .pipe(plumber())
            .pipe(gulp.dest(dirs.dev));
    });
    return bundle;
});

gulp.task('build-prod', function() {
    var bundle = glob(sources, function (err, files) {
        var streams = files.map(function (entry) {
            return browserify({
                    entries: entry
                })
                .bundle()
                .pipe(source(entry.replace(/^\.\/src\//, '')))
                .pipe(gulp.dest(dirs.release));
        });
        return es.merge(streams);
    });
    assets.forEach(function(asset) {
        gulp.src(asset)
            .pipe(gulp.dest(dirs.release));
    });
    return bundle;
});
