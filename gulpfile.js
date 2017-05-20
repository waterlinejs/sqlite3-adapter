var gulp = require('gulp');
var babel = require('gulp-babel');

gulp.task('default', function () {
  return gulp.src([ 'lib/**' ])
    .pipe(babel({
      modules: 'common'
    }))
    .pipe(gulp.dest('dist'));
});
